import type { SupabaseClient } from "@supabase/supabase-js";

import { CLIPS_BUCKET } from "@/lib/sermon-media/clips";
import { cancelRecordingJobs, logSermonMedia } from "@/lib/sermon-media/jobs";

/**
 * Recording deletion, the FaithForm way: deleting hides at once (every route
 * checks `deleted_at`), and media is purged later by the recording reconciler.
 * Sermon media follows the same pattern: when a recording is deleted its jobs
 * are cancelled; once its media is purged, its rendered clips are removed from
 * storage and its transcripts and clip drafts are deleted. Lessons already
 * saved in the sermon builder are the church's own documents and stay; only
 * their link to the recording goes. Facebook posts stay on Facebook.
 */
export async function cleanUpDeletedRecordings(db: SupabaseClient, limit = 20): Promise<{ cancelled: number; purged: number }> {
  let cancelled = 0;
  let purged = 0;

  const { data: active } = await db
    .from("media_jobs")
    .select("recording_id, stream_recordings!inner(deleted_at)")
    .in("status", ["queued", "dispatched", "running"])
    .not("stream_recordings.deleted_at", "is", null)
    .limit(limit);
  for (const recordingId of new Set((active ?? []).map((row) => row.recording_id as string))) {
    await cancelRecordingJobs(recordingId, db);
    cancelled += 1;
  }

  const { data: gone } = await db
    .from("recording_sermon_media")
    .select("recording_id, church_id, stream_recordings!inner(purged_at)")
    .not("stream_recordings.purged_at", "is", null)
    .limit(limit);
  for (const row of gone ?? []) {
    const recordingId = row.recording_id as string;
    const { data: renders } = await db
      .from("sermon_clip_renders")
      .select("storage_path, sermon_clips!inner(recording_id)")
      .eq("sermon_clips.recording_id", recordingId)
      .not("storage_path", "is", null);
    const paths = (renders ?? []).map((render) => render.storage_path as string);
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await db.storage.from(CLIPS_BUCKET).remove(paths.slice(index, index + 100));
      if (error) {
        logSermonMedia("cleanup_storage_failed", { recordingId });
        continue;
      }
    }
    await db.from("sermon_clips").delete().eq("recording_id", recordingId);
    await db.from("recording_transcripts").delete().eq("recording_id", recordingId);
    await db.from("sermon_recording_sources").delete().eq("recording_id", recordingId);
    await db.from("recording_sermon_media").delete().eq("recording_id", recordingId);
    purged += 1;
    logSermonMedia("recording_media_purged", { recordingId, clips: paths.length });
  }
  return { cancelled, purged };
}
