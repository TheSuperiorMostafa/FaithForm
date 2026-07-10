import { createAdminClient } from "@/lib/supabase/admin";
import { getStreamRelaySettings } from "@/lib/stream/relay";

const SIMULATED_BUCKET = "stream-recordings";

export type SimulatedPlayoutJob = {
  eventId: string;
  churchId: string;
  sourceUrl: string;
  ingestUrl: string;
  streamName: string;
};

export async function queueSimulatedPlayout(input: {
  churchId: string;
  eventId: string;
  storagePath: string;
}) {
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from(SIMULATED_BUCKET)
    .createSignedUrl(input.storagePath, 60 * 60 * 4);

  if (!data?.signedUrl) {
    throw new Error("Could not sign simulated video URL.");
  }

  await admin.from("stream_events").update({
    artwork_url: data.signedUrl,
  }).eq("id", input.eventId);
}

export async function listPendingSimulatedPlayoutJobs(): Promise<
  SimulatedPlayoutJob[]
> {
  const admin = createAdminClient();
  const { data: events } = await admin
    .from("stream_events")
    .select("id, church_id, artwork_url, simulated, status")
    .eq("status", "live")
    .eq("simulated", true)
    .not("artwork_url", "is", null)
    .limit(10);

  if (!events?.length) return [];

  const jobs: SimulatedPlayoutJob[] = [];

  for (const event of events) {
    const churchId = event.church_id as string;
    const settings = await getStreamRelaySettings(churchId, {
      includeSecret: true,
      supabase: admin,
    });

    if (!settings.streamPath || !settings.ingestServerUrl || !settings.streamName) {
      continue;
    }

    jobs.push({
      eventId: event.id as string,
      churchId,
      sourceUrl: event.artwork_url as string,
      ingestUrl: settings.ingestServerUrl,
      streamName: settings.streamName,
    });
  }

  return jobs;
}

export async function clearSimulatedPlayoutSource(eventId: string) {
  const admin = createAdminClient();
  await admin
    .from("stream_events")
    .update({ artwork_url: null })
    .eq("id", eventId);
}
