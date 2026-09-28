import Link from "next/link";
import { notFound } from "next/navigation";
import {
  markSupportEmailReviewed,
  postSupportTicketReply,
  updateSupportTicket,
} from "@/app/admin/actions";
import { PriorityBadge, StatusBadge } from "@/components/admin/badges";
import { formatDateTime } from "@/components/admin/format";
import { PageHeader } from "@/components/admin/page-header";
import { TicketThread } from "@/components/support/ticket-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getAdminSupportTicket } from "@/lib/queries/admin";
import { SUPPORT_COMMENT_MAX_LENGTH } from "@/lib/support/comments";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminSupportTicketPage({ params }: PageProps) {
  const { id } = await params;
  const ticket = await getAdminSupportTicket(id);
  if (!ticket) notFound();
  const ticketEmailNeedsReview = ticket.notificationEmailStatus === "pending" || ticket.notificationEmailStatus === "unconfirmed";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title={ticket.subject}
        description="Review the ticket, reply to the church, and set its status."
      />

      <div role="status" className={`grid min-h-[112px] gap-4 rounded-xl border p-4 text-sm text-foreground sm:grid-cols-[1fr_auto] sm:items-center ${ticketEmailNeedsReview ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-card"}`}>
        <div>
          <p className="font-semibold">Email alert</p>
          <p className="mt-1">
            {ticketEmailNeedsReview
              ? "Support inbox delivery is unconfirmed. Check the inbox and contact the church if needed, then mark this alert handled."
              : ticket.notificationEmailStatus === "sent"
                ? "The email provider accepted the alert. Inbox delivery has not been verified."
                : ticket.notificationEmailStatus === "reviewed"
                  ? "The team manually handled this alert; the original email delivery remains unknown."
                  : "Email delivery was not tracked for this older ticket."}
          </p>
        </div>
        {ticketEmailNeedsReview ? (
          <form action={markSupportEmailReviewed} className="min-w-40">
            <input type="hidden" name="kind" value="ticket" />
            <input type="hidden" name="ticketId" value={ticket.id} />
            <Button type="submit" variant="outline">Mark alert handled</Button>
          </form>
        ) : <p className="min-w-40 text-sm text-muted-foreground">No action needed</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Ticket details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Body
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {ticket.body || "No body provided."}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <DetailItem
              label="Church"
              value={
                ticket.churchId ? (
                  <Link
                    href={`/admin/churches/${ticket.churchId}`}
                    className="font-semibold text-foreground hover:text-accent"
                  >
                    {ticket.churchName ?? "Unknown church"}
                  </Link>
                ) : (
                  "No church"
                )
              }
            />
            <DetailItem
              label="Submitted by"
              value={ticket.submittedByEmail ?? "Unknown"}
            />
            <DetailItem label="Created" value={formatDateTime(ticket.createdAt)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
          <p className="text-sm text-muted-foreground">
            Replies here are visible to the church on their dashboard. Email
            alerts are attempted separately, and any unconfirmed result appears here for review.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <TicketThread
            comments={ticket.comments}
            viewer="platform"
            ticketId={ticket.id}
            reviewAction={markSupportEmailReviewed}
            emptyLabel="Nothing has been said to this church yet."
          />

          <form action={postSupportTicketReply} className="space-y-3">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <div className="space-y-2">
              <Label htmlFor="reply">Reply to the church</Label>
              <Textarea
                id="reply"
                name="body"
                rows={5}
                required
                maxLength={SUPPORT_COMMENT_MAX_LENGTH}
                placeholder="What should they hear back?"
              />
            </div>
            <Button type="submit">Post reply and send email alert</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin update</CardTitle>
          <p className="text-sm text-muted-foreground">
            Status and internal notes. Notes are for us only — the church never
            sees them. Post a reply above to say something they can read.
          </p>
        </CardHeader>
        <CardContent>
          <form action={updateSupportTicket} className="space-y-4">
            <input type="hidden" name="ticketId" value={ticket.id} />
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={ticket.status}>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminNotes">Internal notes (private)</Label>
              <Textarea
                id="adminNotes"
                name="adminNotes"
                rows={8}
                defaultValue={ticket.adminNotes ?? ""}
              />
            </div>
            <Button type="submit">Save ticket</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-foreground">{value}</div>
    </div>
  );
}
