import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The shared half of a support ticket thread — the shape both sides read and
 * the one write path both sides post through.
 *
 * `author_role` is decided here from which entry point was called, never from
 * anything the caller passes in. A church posting a reply cannot mark it as
 * coming from us, because the value is not an argument.
 */

export type SupportCommentAuthorRole = "platform" | "church";

export type SupportTicketComment = {
  id: string;
  authorRole: SupportCommentAuthorRole;
  authorName: string | null;
  body: string;
  createdAt: string;
};

/** Long enough for a real answer, short enough that nobody pastes a log dump. */
export const SUPPORT_COMMENT_MAX_LENGTH = 4000;

type CommentRow = {
  id: string;
  author_role: string;
  author_name: string | null;
  body: string;
  created_at: string;
};

function mapComment(row: CommentRow): SupportTicketComment {
  return {
    id: row.id,
    authorRole: row.author_role === "platform" ? "platform" : "church",
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

/**
 * Pre-0069 databases have tickets but no thread. Reading one there should show
 * an empty conversation, not an error page over a ticket that loaded fine.
 */
function isMissingCommentsTable(message: string): boolean {
  return /support_ticket_comments/i.test(message);
}

export async function getTicketComments(
  client: SupabaseClient,
  ticketId: string,
): Promise<SupportTicketComment[]> {
  const { data, error } = await client
    .from("support_ticket_comments")
    .select("id, author_role, author_name, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) {
    if (!isMissingCommentsTable(error.message)) {
      console.error("getTicketComments:", error.message);
    }
    return [];
  }

  return ((data ?? []) as CommentRow[]).map(mapComment);
}

/** Every thread for a set of tickets, keyed by ticket id. One round trip. */
export async function getCommentsForTickets(
  client: SupabaseClient,
  ticketIds: string[],
): Promise<Map<string, SupportTicketComment[]>> {
  const byTicket = new Map<string, SupportTicketComment[]>();
  if (ticketIds.length === 0) return byTicket;

  const { data, error } = await client
    .from("support_ticket_comments")
    .select("id, ticket_id, author_role, author_name, body, created_at")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: true });

  if (error) {
    if (!isMissingCommentsTable(error.message)) {
      console.error("getCommentsForTickets:", error.message);
    }
    return byTicket;
  }

  for (const row of (data ?? []) as (CommentRow & { ticket_id: string })[]) {
    const existing = byTicket.get(row.ticket_id) ?? [];
    existing.push(mapComment(row));
    byTicket.set(row.ticket_id, existing);
  }

  return byTicket;
}

export type PostCommentInput = {
  ticketId: string;
  churchId: string | null;
  authorRole: SupportCommentAuthorRole;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
};

/**
 * Writes one post. Requires a service-role client: the table grants writes to
 * nothing else, so both sides go through a server action that has already
 * decided who the author is.
 */
export async function postTicketComment(
  admin: SupabaseClient,
  input: PostCommentInput,
): Promise<{ error?: string }> {
  const body = input.body.trim();

  if (!body) return { error: "Write a message before posting." };
  if (body.length > SUPPORT_COMMENT_MAX_LENGTH) {
    return {
      error: `Keep it under ${SUPPORT_COMMENT_MAX_LENGTH.toLocaleString()} characters.`,
    };
  }

  const { error } = await admin.from("support_ticket_comments").insert({
    ticket_id: input.ticketId,
    church_id: input.churchId,
    author_role: input.authorRole,
    author_user_id: input.authorUserId,
    author_name: input.authorName,
    body,
  });

  if (error) {
    if (isMissingCommentsTable(error.message)) {
      return {
        error:
          "Ticket replies are not available until migration 0069 has been applied.",
      };
    }
    return { error: error.message };
  }

  return {};
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export function supportStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
