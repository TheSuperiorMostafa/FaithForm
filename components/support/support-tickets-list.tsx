"use client";

import { useState, useTransition } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { replyToSupportTicket } from "@/app/dashboard/support/actions";
import { supportTicketStatus } from "@/app/dashboard/support/ticket-helpers";
import { TicketThread } from "@/components/support/ticket-thread";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SUPPORT_COMMENT_MAX_LENGTH } from "@/lib/support/comments";
import type { ChurchSupportTicketRow } from "@/lib/queries/support";

export function SupportTicketsList({
  tickets,
}: {
  tickets: ChurchSupportTicketRow[];
}) {
  if (tickets.length === 0) {
    return (
      <EmptyState
        compact
        icon={MessageCircle}
        title="No messages yet"
        description="When you send us a message, you can follow our reply here."
      />
    );
  }

  return (
    <ul className="divide-y divide-border rounded-3xl border border-border bg-card shadow-sm">
      {tickets.map((ticket) => (
        <TicketCard key={ticket.id} ticket={ticket} />
      ))}
    </ul>
  );
}

function TicketCard({ ticket }: { ticket: ChurchSupportTicketRow }) {
  // Anything we have said is open on arrival; a reply nobody expands is a
  // reply nobody reads. A ticket we have not answered yet stays collapsed.
  const hasReplies = ticket.comments.length > 0;
  const [open, setOpen] = useState(hasReplies && ticket.status !== "resolved");
  const status = supportTicketStatus(ticket);
  const panelId = `ticket-${ticket.id}`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[72px] w-full items-center gap-4 rounded-3xl px-5 py-4 text-left transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-base font-semibold text-foreground">
            {ticket.subject}
          </span>
          <span className="block text-sm text-muted-foreground">
            Sent {new Date(ticket.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            {hasReplies
              ? ` · ${ticket.comments.length} ${ticket.comments.length === 1 ? "reply" : "replies"}`
              : ""}
          </span>
        </span>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <ChevronDown
          aria-hidden
          className={cn("size-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-5 border-t border-border px-5 py-5">
          {ticket.body && (
            <div>
              <p className="text-sm font-semibold text-muted-foreground">What you sent</p>
              <p className="mt-1 whitespace-pre-wrap text-[15px] text-foreground">
                {ticket.body}
              </p>
            </div>
          )}

          <TicketThread
            comments={ticket.comments}
            viewer="church"
            emptyLabel="No reply yet. We'll email you as soon as we've looked at this."
          />

          <ReplyBox ticketId={ticket.id} />
        </div>
      )}
    </li>
  );
}

function ReplyBox({ ticketId }: { ticketId: string }) {
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      try {
        const result = await replyToSupportTicket({ ticketId, body });
        if (result.error) {
          setError(result.error);
          return;
        }
        setBody("");
        toast.success("Reply sent to FaithForm.");
      } catch {
        setError("We couldn't send your reply. Check your connection and try again.");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Label htmlFor={`reply-${ticketId}`} className="text-[15px] font-semibold">
        Write back
      </Label>
      <Textarea
        id={`reply-${ticketId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={SUPPORT_COMMENT_MAX_LENGTH}
        placeholder="Anything else we should know?"
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
