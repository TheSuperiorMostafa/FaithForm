import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { startLiveBroadcast } from "@/lib/stream/go-live";
import { queueSimulatedPlayout } from "@/lib/stream/simulated";

export async function startDueScheduledEvents(
  supabase?: SupabaseClient,
): Promise<{ started: number; simulated: number }> {
  const client = supabase ?? createAdminClient();
  const now = new Date().toISOString();

  const { data: events, error } = await client
    .from("stream_events")
    .select("*")
    .eq("status", "scheduled")
    .lte("starts_at", now)
    .order("starts_at", { ascending: true })
    .limit(20);

  if (error || !events?.length) {
    return { started: 0, simulated: 0 };
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

  return { started, simulated };
}
