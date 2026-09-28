import type { SupabaseClient } from "@supabase/supabase-js";

/** Keep a saved ticket visible for review when its separate email is uncertain. */
export async function recordSupportEmailStatus(
  admin: SupabaseClient,
  source: "support_tickets" | "support_ticket_comments",
  id: string,
  confirmed: boolean,
): Promise<void> {
  try {
    const { data, error } = await admin
      .from(source)
      .update({ notification_email_status: confirmed ? "sent" : "unconfirmed" })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    // The row's default remains `pending` if this write fails or the worker
    // disappears. Admin shows both pending and unconfirmed as needing review.
    if (error || !data) {
      console.error("[support] email status update failed:", source, error?.code ?? "missing row");
    }
  } catch (error) {
    console.error("[support] email status update failed:", source, error instanceof Error ? error.name : "unknown");
  }
}
