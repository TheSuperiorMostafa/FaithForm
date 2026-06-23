import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const MAX_HEARTBEAT_SECONDS = 120;

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function recordDashboardHeartbeat(
  input: {
    userId: string;
    churchId: string;
    seconds: number;
  },
  supabase?: SupabaseClient,
): Promise<void> {
  const client = supabase ?? createClient();
  const seconds = Math.max(1, Math.min(MAX_HEARTBEAT_SECONDS, Math.floor(input.seconds)));
  const usageDate = todayUtcDate();
  const now = new Date().toISOString();

  const { data: existing, error: readError } = await client
    .from("dashboard_usage_daily")
    .select("id, active_seconds")
    .eq("church_id", input.churchId)
    .eq("user_id", input.userId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  if (readError) {
    console.error("recordDashboardHeartbeat read:", readError.message);
    return;
  }

  if (existing?.id) {
    const { error } = await client
      .from("dashboard_usage_daily")
      .update({
        active_seconds: (existing.active_seconds as number) + seconds,
        last_seen_at: now,
      })
      .eq("id", existing.id);

    if (error) {
      console.error("recordDashboardHeartbeat update:", error.message);
    }
    return;
  }

  const { error } = await client.from("dashboard_usage_daily").insert({
    church_id: input.churchId,
    user_id: input.userId,
    usage_date: usageDate,
    active_seconds: seconds,
    last_seen_at: now,
  });

  if (error) {
    console.error("recordDashboardHeartbeat insert:", error.message);
  }
}

export { MAX_HEARTBEAT_SECONDS };
