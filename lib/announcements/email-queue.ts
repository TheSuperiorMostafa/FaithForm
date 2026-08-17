import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type QueuedEmailEvent = {
  googleEventId: string;
  calendarId: string | null;
  addedAt: string;
};

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

/** A database that has not had migration 0048 applied yet has no queue. */
function isMissingQueueTable(message: string): boolean {
  return /announcement_email_queue/i.test(message);
}

/**
 * The events someone has put in this week's email.
 *
 * Scoped by `weekStartKey`, which is how the queue resets: at Monday midnight
 * in the church's timezone the key advances and last week's rows stop matching.
 */
export async function listEmailQueue(
  churchId: string,
  weekStartKey: string,
  supabase?: SupabaseClient,
): Promise<QueuedEmailEvent[]> {
  const { data, error } = await client(supabase)
    .from("announcement_email_queue")
    .select("google_event_id, calendar_id, added_at")
    .eq("church_id", churchId)
    .eq("week_start", weekStartKey)
    .order("added_at", { ascending: true });

  if (error) {
    if (!isMissingQueueTable(error.message)) {
      console.error("listEmailQueue:", error.message);
    }
    return [];
  }

  return (data ?? []).map((row) => ({
    googleEventId: row.google_event_id as string,
    calendarId: (row.calendar_id as string | null) ?? null,
    addedAt: row.added_at as string,
  }));
}

export async function addToEmailQueue(
  input: {
    churchId: string;
    weekStartKey: string;
    googleEventId: string;
    calendarId?: string | null;
    addedBy?: string | null;
  },
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await client(supabase)
    .from("announcement_email_queue")
    .upsert(
      {
        church_id: input.churchId,
        week_start: input.weekStartKey,
        google_event_id: input.googleEventId,
        calendar_id: input.calendarId ?? null,
        added_by: input.addedBy ?? null,
      },
      { onConflict: "church_id,week_start,google_event_id" },
    );

  if (error) {
    if (isMissingQueueTable(error.message)) {
      return {
        ok: false,
        error:
          "The announcement email queue isn't set up yet. Run `pnpm db:email-queue`.",
      };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function removeFromEmailQueue(
  input: { churchId: string; weekStartKey: string; googleEventId: string },
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await client(supabase)
    .from("announcement_email_queue")
    .delete()
    .eq("church_id", input.churchId)
    .eq("week_start", input.weekStartKey)
    .eq("google_event_id", input.googleEventId);

  if (error && !isMissingQueueTable(error.message)) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
