import "server-only";

import type { LessonEvidence } from "@/lib/sermon-media/lesson";
import { createAdminClient } from "@/lib/supabase/admin";

export type LessonRecordingSource = {
  recordingId: string;
  recordingTitle: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  evidence: LessonEvidence;
  /**
   * Point and question links are matched by position, so they are shown only
   * while the lesson is as generated. Section and Scripture links stay valid.
   */
  positionsReliable: boolean;
};

/**
 * The recording a lesson was built from, for its source links. Church-scoped;
 * a deleted recording returns null so the lesson simply stands on its own.
 */
export async function getLessonRecordingSource(sermonId: string, churchId: string): Promise<LessonRecordingSource | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("sermon_recording_sources")
    .select("recording_id, needs_review, review_reason, input_version, evidence, generated_sermon_updated_at, stream_recordings!inner(title, deleted_at), sermons!inner(updated_at)")
    .eq("sermon_id", sermonId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (!data) return null;
  const recording = data.stream_recordings as unknown as { title: string | null; deleted_at: string | null };
  if (recording.deleted_at) return null;
  const { data: state } = await db
    .from("recording_sermon_media")
    .select("input_version")
    .eq("recording_id", data.recording_id)
    .maybeSingle();
  const sermon = data.sermons as unknown as { updated_at: string };
  const generatedAt = data.generated_sermon_updated_at ? new Date(data.generated_sermon_updated_at).getTime() : 0;
  const positionsReliable = generatedAt > 0 && new Date(sermon.updated_at).getTime() <= generatedAt + 1000;
  const stale = state ? Number(state.input_version) > Number(data.input_version) : false;
  return {
    recordingId: data.recording_id,
    recordingTitle: recording.title,
    needsReview: Boolean(data.needs_review || stale),
    reviewReason: data.review_reason ?? (stale ? "The sermon range or transcript changed." : null),
    evidence: data.evidence as LessonEvidence,
    positionsReliable,
  };
}
