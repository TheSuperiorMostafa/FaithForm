"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PriorityBadge, StatusBadge } from "@/components/admin/badges";
import { formatDate } from "@/components/admin/format";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { AdminTicketListRow } from "@/lib/queries/admin";

export function SupportTicketsTable({
  tickets,
}: {
  tickets: AdminTicketListRow[];
}) {
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");

  const filtered = useMemo(
    () =>
      tickets.filter((ticket) => {
        if (status !== "all" && ticket.status !== status) return false;
        if (priority !== "all" && ticket.priority !== priority) return false;
        return true;
      }),
    [priority, status, tickets],
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Tickets</h2>
          <p className="text-sm text-muted-foreground">
            Filter platform support by status and priority.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
          </Select>
          <Select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="all">All priorities</option>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-primary font-heading text-[13px] uppercase tracking-wide text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
            <tr>
              <th className="px-5 py-4 text-left">Subject</th>
              <th className="px-5 py-4 text-left">Church</th>
              <th className="px-5 py-4 text-left">Priority</th>
              <th className="px-5 py-4 text-left">Status</th>
              <th className="px-5 py-4 text-left">Submitted by</th>
              <th className="px-5 py-4 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ticket) => (
              <tr key={ticket.id} className="even:bg-background/60 hover:bg-accent/10">
                <td className="px-5 py-4 font-semibold text-foreground">
                  <Link href={`/admin/support/${ticket.id}`} className="hover:text-accent">
                    {ticket.subject}
                  </Link>
                </td>
                <td className="px-5 py-4">
                  {ticket.churchId ? (
                    <Link
                      href={`/admin/churches/${ticket.churchId}`}
                      className="hover:text-accent"
                    >
                      {ticket.churchName ?? "Unknown church"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No church</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td className="px-5 py-4">
                  <StatusBadge status={ticket.status} />
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  {ticket.submittedByEmail ?? "Unknown"}
                </td>
                <td className="px-5 py-4 text-muted-foreground">
                  {formatDate(ticket.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No tickets match the selected filters.
        </div>
      )}
    </Card>
  );
}
