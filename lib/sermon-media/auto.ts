import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueTranscription, logSermonMedia } from "@/lib/sermon-media/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Automatic transcription after a livestream's recording is verified ready.
 *
 * The sweep is the durable path: every dispatch run looks for verified, playable
 * recordings of opted-in churches that have no transcript job for their current
 * verified revision, and queues one. It covers segmented and uploaded
 * recordings, a missed hook, and a deploy mid-service. The lifecycle hook only
 * makes it start sooner. Enqueue is idempotent, so both firing is harmless.
 *
 * Only recordings that became ready in the last few days are swept, so turning
 * the feature on does not transcribe a church's whole archive; older ones are
 * transcribed on request from the recording page.
 */
const SWEEP_LOOKBACK_DAYS = 3;

type Candidate = {
  id: string;
  church_id: string;
  mobile_rendition_revision: number | null;
  source_kind: string;
};

export function autoTranscriptionEnabled(): boolean {
  return process.env.SERMON_MEDIA_ENABLED === "1";
}

export async function sweepAutoTranscriptions(
  db: SupabaseClient = createAdminClient(),
  options: { limit?: number; now?: Date } = {},
): Promise<{ queued: number; checked: number }> {
  if (!autoTranscriptionEnabled()) return { queued: 0, checked: 0 };
  const { data: settings } = await db
    .from("sermon_media_settings")
    .select("church_id, language")
    .eq("enabled", true)
    .eq("auto_transcribe", true);
  const churches = new Map((settings ?? []).map((row) => [row.church_id as string, String(row.language ?? "auto")]));
  if (churches.size === 0) return { queued: 0, checked: 0 };

  const since = new Date((options.now ?? new Date()).getTime() - SWEEP_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: recordings } = await db
    .from("stream_recordings")
    .select("id, church_id, mobile_rendition_revision, source_kind")
    .in("church_id", [...churches.keys()])
    .in("status", ["ready", "published"])
    .eq("mobile_playable", true)
    .is("deleted_at", null)
    .gte("ready_at", since)
    .order("ready_at", { ascending: true })
    .limit(options.limit ?? 200);

  let queued = 0;
  for (const recording of (recordings ?? []) as Candidate[]) {
    const revision = Number(recording.mobile_rendition_revision ?? 0);
    const { data: jobs } = await db
      .from("media_jobs")
      .select("id, status, params")
      .eq("recording_id", recording.id)
      .eq("kind", "transcribe")
      .contains("params", { revision })
      .limit(1);
    if (jobs && jobs.length > 0) continue; // live, done, or failed for this revision: staff retry is explicit
    const { job } = await enqueueTranscription(
      {
        churchId: recording.church_id,
        recordingId: recording.id,
        revision,
        language: churches.get(recording.church_id) ?? "auto",
        source: "auto",
      },
      db,
    );
    if (job) queued += 1;
  }
  if (queued > 0) logSermonMedia("auto_transcriptions_queued", { queued });
  return { queued, checked: recordings?.length ?? 0 };
}

/** Lifecycle hook for one recording that has just been verified playable. */
export async function onRecordingVerifiedReady(
  recording: { id: string; churchId: string; renditionRevision: number },
  db: SupabaseClient = createAdminClient(),
): Promise<void> {
  if (!autoTranscriptionEnabled()) return;
  const { data: settings } = await db
    .from("sermon_media_settings")
    .select("enabled, auto_transcribe, language")
    .eq("church_id", recording.churchId)
    .maybeSingle();
  if (!settings?.enabled || !settings.auto_transcribe) return;
  const { data: jobs } = await db
    .from("media_jobs")
    .select("id")
    .eq("recording_id", recording.id)
    .eq("kind", "transcribe")
    .contains("params", { revision: recording.renditionRevision })
    .limit(1);
  if (jobs && jobs.length > 0) return;
  await enqueueTranscription(
    {
      churchId: recording.churchId,
      recordingId: recording.id,
      revision: recording.renditionRevision,
      language: String(settings.language ?? "auto"),
      source: "auto",
    },
    db,
  );
}
