import type { SupabaseClient } from "@supabase/supabase-js";

import type { MediaJobRow } from "@/lib/sermon-media/jobs";
import type { RangeSuggestion } from "@/lib/sermon-media/sermon-range";
import type { AudioEvent, Transcript, TranscriptGap, TranscriptSegment } from "@/lib/sermon-media/transcript";

/**
 * Reads and writes for sermon media rows. Callers have already authorized the
 * church and recording (access.ts); every query is still scoped by church_id.
 */
export type SermonMediaState = {
  recordingId: string;
  currentTranscriptVersion: number | null;
  suggestion: {
    status: "none" | "suggested" | "uncertain" | "failed";
    startSec: number | null;
    endSec: number | null;
    confidence: number | null;
    evidence: RangeSuggestion["evidence"];
    forVersion: number | null;
  };
  confirmed: { startSec: number; endSec: number; by: string | null; at: string; transcriptVersion: number | null } | null;
  inputVersion: number;
};

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export async function getSermonMediaState(
  db: SupabaseClient,
  churchId: string,
  recordingId: string,
): Promise<SermonMediaState> {
  const { data } = await db
    .from("recording_sermon_media")
    .select("*")
    .eq("recording_id", recordingId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (!data) {
    return {
      recordingId,
      currentTranscriptVersion: null,
      suggestion: { status: "none", startSec: null, endSec: null, confidence: null, evidence: [], forVersion: null },
      confirmed: null,
      inputVersion: 0,
    };
  }
  return {
    recordingId,
    currentTranscriptVersion: num(data.current_transcript_version),
    suggestion: {
      status: data.suggestion_status,
      startSec: num(data.suggested_start_sec),
      endSec: num(data.suggested_end_sec),
      confidence: num(data.suggestion_confidence),
      evidence: (data.suggestion_evidence ?? []) as RangeSuggestion["evidence"],
      forVersion: num(data.suggested_for_version),
    },
    confirmed:
      data.confirmed_start_sec === null
        ? null
        : {
            startSec: Number(data.confirmed_start_sec),
            endSec: Number(data.confirmed_end_sec),
            by: data.confirmed_by,
            at: data.confirmed_at,
            transcriptVersion: num(data.confirmed_transcript_version),
          },
    inputVersion: Number(data.input_version ?? 0),
  };
}

export async function getTranscript(
  db: SupabaseClient,
  churchId: string,
  recordingId: string,
  version?: number | null,
): Promise<Transcript | null> {
  let query = db
    .from("recording_transcripts")
    .select("version, kind, language, engine, duration_sec, segments, gaps, audio_events, created_at")
    .eq("recording_id", recordingId)
    .eq("church_id", churchId);
  query = version ? query.eq("version", version) : query.order("version", { ascending: false }).limit(1);
  const { data } = await query.maybeSingle();
  if (!data) return null;
  return {
    version: data.version,
    kind: data.kind,
    language: data.language,
    engine: data.engine,
    durationSec: num(data.duration_sec),
    segments: (data.segments ?? []) as TranscriptSegment[],
    gaps: (data.gaps ?? []) as TranscriptGap[],
    audioEvents: (data.audio_events ?? []) as AudioEvent[],
    createdAt: data.created_at,
  };
}

export async function getLatestJob(
  db: SupabaseClient,
  churchId: string,
  recordingId: string,
  kind: "transcribe" | "render_clip",
  subjectId?: string,
): Promise<MediaJobRow | null> {
  let query = db
    .from("media_jobs")
    .select("*")
    .eq("church_id", churchId)
    .eq("recording_id", recordingId)
    .eq("kind", kind);
  if (subjectId) query = query.eq("subject_id", subjectId);
  const { data } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as MediaJobRow | null) ?? null;
}

export async function saveRangeSuggestion(
  db: SupabaseClient,
  recordingId: string,
  forVersion: number,
  suggestion: RangeSuggestion,
): Promise<void> {
  await db
    .from("recording_sermon_media")
    .update({
      suggestion_status: suggestion.status,
      suggested_start_sec: suggestion.startSec,
      suggested_end_sec: suggestion.endSec,
      suggestion_confidence: suggestion.confidence,
      suggestion_evidence: suggestion.evidence.slice(0, 20),
      suggested_for_version: forVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("recording_id", recordingId);
}

/** A public, staff-safe view of a job: no lease, attempt or dispatch internals. */
export function publicJob(job: MediaJobRow | null) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    errorCode: job.last_error_code,
    error: job.last_error,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  };
}
