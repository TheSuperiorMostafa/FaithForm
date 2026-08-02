import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { startLiveBroadcast } from "@/lib/stream/go-live";
import { queueSimulatedPlayout } from "@/lib/stream/simulated";

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
): Promise<{ started: number; simulated: number; expired?: number }> {
  const client = supabase ?? createAdminClient();
  const now = new Date().toISOString();
  const earliest = new Date(Date.now() - START_GRACE_MS).toISOString();

  const { data: expiredRows } = await client
    .from("stream_events")
    .update({ status: "cancelled" })
    .eq("status", "scheduled")
    .lt("starts_at", earliest)
    .select("id");

  const expired = expiredRows?.length ?? 0;

  const { data: events, error } = await client
    .from("stream_events")
    .select("*")
    .eq("status", "scheduled")
    .lte("starts_at", now)
    .gte("starts_at", earliest)
    .order("starts_at", { ascending: true })
    .limit(20);

  if (error || !events?.length) {
    return { started: 0, simulated: 0, expired };
  }

  let started = 0;
  let simulated = 0;

  for (const row of events) {
    const eventId = row.id as string;
    const churchId = row.church_id as string;
    const createdBy = row.created_by as string | null;
    const isSimulated = Boolean(row.simulated);

    try {
      const { data: active } = await client
        .from("stream_sessions")
        .select("id")
        .eq("church_id", churchId)
        .in("status", ["preparing", "waiting_for_encoder", "live"])
        .limit(1)
        .maybeSingle();

      if (active) continue;

      await startLiveBroadcast(
        churchId,
        createdBy,
        { eventId },
        client,
      );

      if (isSimulated && row.simulated_source_path) {
        await queueSimulatedPlayout({
          churchId,
          eventId,
          storagePath: row.simulated_source_path as string,
        });
        simulated++;
      }

      started++;
    } catch (err) {
      console.error("scheduled-start failed", eventId, err);
    }
  }

  return { started, simulated, expired };
}
