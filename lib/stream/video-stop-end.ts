import type { SupabaseClient } from "@supabase/supabase-js";

import { withBroadcastOperation } from "@/lib/stream/encoder-automation-settings";
import { endLiveBroadcastLocked } from "@/lib/stream/go-live";
import { getPreviewIngestEvidence } from "@/lib/stream/preview-ingest";
import { logRecordingEvent } from "@/lib/stream/recording-lifecycle";
import { RELAY_HEARTBEAT_TTL_MS } from "@/lib/stream/recording-model";
import { productionLifecycleDeps } from "@/lib/stream/recording-runtime";
import { getActiveStreamSession, type StreamSession } from "@/lib/stream/sessions";
import { decideVideoStop, videoEvidence, type VideoStopDecision } from "@/lib/stream/video-stop";
import { createAdminClient } from "@/lib/supabase/admin";

async function decide(
  churchId: string,
  session: StreamSession,
  client: SupabaseClient,
  now: number,
): Promise<VideoStopDecision> {
  const [preview, ingest] = await Promise.all([
    getPreviewIngestEvidence(churchId, client, now),
    productionLifecycleDeps(client).repo.getIngestStatus(churchId),
  ]);
  const evidence = videoEvidence({ preview, ingest, ingestTtlMs: RELAY_HEARTBEAT_TTL_MS, now });
  return decideVideoStop({
    sessionStatus: session.status,
    liveSince: session.liveStartedAt ?? session.ingestStartedAt,
    ...evidence,
    now,
  });
}

/**
 * Ends this church's live service when its video stopped and did not come
 * back within the grace window — the same end as pressing End service: the
 * platforms are closed, the recording is finalised and post-service
 * processing starts.
 *
 * Reads first and takes the broadcast lease only when the answer is "end",
 * then decides again under the lease, so a reconnect or a manual End that
 * landed in between always wins. Returns true when it ended the service.
 */
export async function endLiveServiceIfVideoStopped(
  churchId: string,
  options: { expectedSessionId?: string; client?: SupabaseClient } = {},
): Promise<boolean> {
  const client = options.client ?? createAdminClient();
  const session = await getActiveStreamSession(churchId, client);
  if (!session || (options.expectedSessionId && session.id !== options.expectedSessionId)) return false;
  if ((await decide(churchId, session, client, Date.now())).action !== "end") return false;

  try {
    return await withBroadcastOperation(churchId, client, async () => {
      const current = await getActiveStreamSession(churchId, client);
      if (current?.id !== session.id) return false;
      const decision = await decide(churchId, current, client, Date.now());
      if (decision.action !== "end") return false;
      // The paired FaithForm encoder is left alone: a replacement encoder may
      // already be reconnecting, and its own stop is what got us here.
      const ended = await endLiveBroadcastLocked(churchId, client, {
        expectedSessionId: current.id,
        stopPairedEncoder: false,
      });
      if (ended) {
        logRecordingEvent("broadcast_ended_after_video_stopped", {
          churchId,
          sessionId: current.id,
          reason: decision.reason,
        });
      }
      return Boolean(ended);
    });
  } catch (error) {
    // Usually another start/stop holding the lease; the next poll or the
    // cron tries again.
    console.error("Could not end a service whose video stopped", churchId, error instanceof Error ? error.message : error);
    return false;
  }
}

/** The cron's sweep: every live service whose video stopped. */
export async function endLiveServicesWithStoppedVideo(client: SupabaseClient = createAdminClient()) {
  const { data, error } = await client
    .from("stream_sessions")
    .select("id, church_id")
    .eq("status", "live")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  let ended = 0;
  for (const row of data ?? []) {
    const did = await endLiveServiceIfVideoStopped(row.church_id as string, {
      expectedSessionId: row.id as string,
      client,
    }).catch(() => false);
    if (did) ended += 1;
  }
  return ended;
}
