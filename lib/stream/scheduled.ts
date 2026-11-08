import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEncoderAutoGoLive } from "@/lib/stream/encoder-automation-settings";
import { startLiveBroadcast } from "@/lib/stream/go-live";
import { retryPendingSimulatedPlayouts, type SimulatedPlayoutStart } from "@/lib/stream/simulated";

/**
 * How late a service may start.
 *
 * Generous enough to ride out a cron outage, short enough that a service nobody
 * showed up for does not go live by itself. Without a lower bound this started
 * *any* scheduled event whose time had passed — so the first run after the cron
 * was finally wired up went live on a three-week-old abandoned event, and would
 * have published it to YouTube had that event syndicated. Anything older is
 * cancelled rather than left scheduled, so it stops being reconsidered every two
 * minutes and stops occupying the batch.
 */
const START_GRACE_MS = 30 * 60 * 1000;

export async function startDueScheduledEvents(
  supabase?: SupabaseClient,
): Promise<{ started: number; simulated: number; expired: number; failed: number; deferred: number }> {
  const client = supabase ?? createAdminClient();
  const now = new Date().toISOString();
  const earliest = new Date(Date.now() - START_GRACE_MS).toISOString();

  const { data: expiredRows, error: expiryError } = await client
    .from("stream_events")
    .update({ status: "cancelled" })
    .eq("status", "scheduled")
    .lt("starts_at", earliest)
    .select("id");
  if (expiryError) throw new Error("Scheduled stream expiry failed");

  const expired = expiredRows?.length ?? 0;

  const { data: events, error } = await client
    .from("stream_events")
    .select("*")
    .eq("status", "scheduled")
    .lte("starts_at", now)
    .gte("starts_at", earliest)
    .order("starts_at", { ascending: true })
    .limit(20);

  if (error) throw new Error("Scheduled stream list failed");

  let started = 0;
  let failed = 0;
  let deferred = 0;
  const newlyStarted: SimulatedPlayoutStart[] = [];

  for (const row of events ?? []) {
    const eventId = row.id as string;
    const churchId = row.church_id as string;
    const createdBy = row.created_by as string | null;

    try {
      if (!row.simulated && await getEncoderAutoGoLive(churchId, client)) {
        deferred++;
        continue;
      }

      const { data: active, error: activeError } = await client
        .from("stream_sessions")
        .select("id, status, error_message, created_at")
        .eq("church_id", churchId)
        .in("status", ["preparing", "waiting_for_encoder", "live"])
        .limit(1)
        .maybeSingle();

      if (activeError) throw new Error("Scheduled stream session read failed");
      if (active) {
        if (active.status === "preparing" && (
          active.error_message || Date.now() - Date.parse(active.created_at) > 5 * 60 * 1000
        )) failed++;
        else deferred++;
        continue;
      }

      await startLiveBroadcast(
        churchId,
        createdBy,
        { eventId },
        client,
      );

      started++;
      if (row.simulated && typeof row.simulated_source_path === "string" && row.simulated_source_path) {
        newlyStarted.push({ churchId, eventId, storagePath: row.simulated_source_path });
      }
    } catch {
      failed++;
    }
  }

  // Live events remain pending handoffs after a signing/write failure or an
  // interrupted invocation, so the next cron/poll repairs them in place.
  const handoffs = await retryPendingSimulatedPlayouts(client, newlyStarted);
  return {
    started, simulated: handoffs.prepared, expired,
    failed: failed + handoffs.failed, deferred: deferred + handoffs.deferred,
  };
}
