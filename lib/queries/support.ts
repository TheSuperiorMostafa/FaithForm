import {
  getCommentsForTickets,
  type SupportTicketComment,
} from "@/lib/support/comments";
import { createClient } from "@/lib/supabase/server";

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
): Promise<ChurchSupportTicketRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .select("id, subject, body, status, priority, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getChurchSupportTickets:", error.message);
    return [];
  }

  const rows = data ?? [];
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
