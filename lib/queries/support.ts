import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCommentsForTickets,
  type SupportTicketComment,
} from "@/lib/support/comments";
import { createClient } from "@/lib/supabase/server";
import { readAllById } from "@/lib/queries/paged-read";

export type ChurchSupportTicketRow = {
  id: string;
  subject: string;
  body: string | null;
  status: "open" | "in_progress" | "resolved";
  priority: string;
  createdAt: string;
  /**
   * The conversation, oldest first. Carried on every ticket rather than
   * fetched when one is expanded: a church has a handful of tickets, and a
   * reply they cannot see until they click is a reply they will not notice.
   */
  comments: SupportTicketComment[];
};

export async function getChurchSupportTickets(
  churchId: string,
  supabase: SupabaseClient = createClient(),
): Promise<ChurchSupportTicketRow[]> {
  const rows = await readAllById<{
    id: string;
    subject: string;
    body: string | null;
    status: ChurchSupportTicketRow["status"];
    priority: string;
    created_at: string;
  }>(
    async (afterId, includeCount, pageSize) => {
      let query = supabase
        .from("support_tickets")
        .select("id, subject, body, status, priority, created_at", {
          count: includeCount ? "exact" : undefined,
        })
        .eq("church_id", churchId);
      if (afterId) query = query.gt("id", afterId);
      return await query.order("id", { ascending: true }).limit(pageSize);
    },
    { label: "support tickets" },
  );
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const comments = await getCommentsForTickets(
    supabase,
    rows.map((row) => row.id as string),
  );

  return rows.map((row) => ({
    id: row.id as string,
    subject: row.subject as string,
    body: (row.body as string) ?? null,
    status: row.status as ChurchSupportTicketRow["status"],
    priority: row.priority as string,
    createdAt: row.created_at as string,
    comments: comments.get(row.id as string) ?? [],
  }));
}
