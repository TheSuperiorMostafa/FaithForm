import { StatusBadge } from "@/components/admin/badges";
import type { ChurchSupportTicketRow } from "@/lib/queries/support";

export function SupportTicketsList({ tickets }: { tickets: ChurchSupportTicketRow[] }) {
  if (tickets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tickets yet. Submit a request above and we&apos;ll get back to you.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {tickets.map((ticket) => (
        <li key={ticket.id} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-medium text-foreground">{ticket.subject}</p>
            <StatusBadge status={ticket.status} />
          </div>
          {ticket.body && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{ticket.body}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Submitted {new Date(ticket.createdAt).toLocaleDateString()}
          </p>
        </li>
      ))}
    </ul>
  );
}
