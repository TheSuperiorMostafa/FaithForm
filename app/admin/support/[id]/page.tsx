import Link from "next/link";
import { notFound } from "next/navigation";
import {
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title={ticket.subject}
        description="Review the ticket, reply to the church, and set its status."
      />

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
            Everything here is visible to the church on their dashboard, and
            every reply you post is emailed to whoever raised the ticket.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <TicketThread
            comments={ticket.comments}
            viewer="platform"
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
            <Button type="submit">Post reply &amp; email them</Button>
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
