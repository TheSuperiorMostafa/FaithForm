"use client";

import { useState, useTransition } from "react";
import { StatusBadge } from "@/components/admin/badges";
import { TicketThread } from "@/components/support/ticket-thread";
import { Button } from "@/components/ui/button";
import { replyToSupportTicket } from "@/app/dashboard/support/actions";
import { SUPPORT_COMMENT_MAX_LENGTH } from "@/lib/support/comments";
import type { ChurchSupportTicketRow } from "@/lib/queries/support";

export function SupportTicketsList({
  tickets,
}: {
  tickets: ChurchSupportTicketRow[];
}) {
  if (tickets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tickets yet. Submit a request above and we&apos;ll get back to you.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
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
  const [open, setOpen] = useState(hasReplies);

  return (
    <li className="rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-col gap-1 px-4 py-3 text-left"
      >
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="font-medium text-foreground">{ticket.subject}</span>
          <StatusBadge status={ticket.status} />
        </span>
        {ticket.body && !open && (
          <span className="line-clamp-2 text-sm text-muted-foreground">
            {ticket.body}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          Submitted {new Date(ticket.createdAt).toLocaleDateString()}
          {hasReplies
            ? ` · ${ticket.comments.length} ${
                ticket.comments.length === 1 ? "reply" : "replies"
              }`
            : ""}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          {ticket.body && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                What you sent
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {ticket.body}
              </p>
            </div>
          )}

          <TicketThread
            comments={ticket.comments}
            viewer="church"
            emptyLabel="No replies yet. We'll email you as soon as we've looked at this."
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
      const result = await replyToSupportTicket({ ticketId, body });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label
        htmlFor={`reply-${ticketId}`}
        className="text-xs uppercase tracking-wide text-muted-foreground"
      >
        Add a reply
      </label>
      <textarea
        id={`reply-${ticketId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={SUPPORT_COMMENT_MAX_LENGTH}
        placeholder="Anything else we should know?"
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
