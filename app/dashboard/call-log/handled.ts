import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reading and writing "Mark as handled" (migration 0104).
 *
 * Migrations are applied separately from deploys, so every read tolerates the
 * columns being missing: the page then simply hides "Mark as handled" rather
 * than failing to load the calls.
 */

export type HandledState = {
  /** False until migration 0104 has run on this database. */
  available: boolean;
  byId: Map<string, string>;
};

type DbError = { code?: string | null; message?: string | null } | null;

/** 42703 is Postgres "undefined column"; PGRST204 is PostgREST's schema-cache miss. */
export function isMissingHandledColumn(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /handled_(at|by)/i.test(error.message ?? "")
  );
}

export async function getHandledState(
  supabase: SupabaseClient,
  churchId: string,
  callIds: string[],
): Promise<HandledState> {
  const byId = new Map<string, string>();
  if (callIds.length === 0) {
    // Still find out whether the column exists, so an empty log is honest
    // about what the page can do once calls arrive.
    const { error } = await supabase
      .from("phone_calls")
      .select("id, handled_at")
      .eq("church_id", churchId)
      .limit(1);
    return { available: !isMissingHandledColumn(error), byId };
  }

  const { data, error } = await supabase
    .from("phone_calls")
    .select("id, handled_at")
    .eq("church_id", churchId)
    .in("id", callIds);

  if (error) {
    if (!isMissingHandledColumn(error)) {
      console.error("[call-log] handled read failed", error.code, error.message);
    }
    return { available: false, byId };
  }

  for (const row of (data ?? []) as Array<{ id: string; handled_at: string | null }>) {
    if (row.handled_at) byId.set(row.id, row.handled_at);
  }
  return { available: true, byId };
}
