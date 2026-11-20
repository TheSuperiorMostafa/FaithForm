/**
 * Client-side shapes and a small JSON fetch helper for /api/sermon-media.
 * The server modules (lib/sermon-media) are server-only, so the shapes the
 * routes return are restated here. Every error body is `{ error, code? }` in
 * plain language, so `error` can be shown as is.
 */

import type { JobProgress as JobProgressView } from "@/lib/sermon-media/progress";

export type JobStatus = "queued" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled";

/** A job that is still going: the page keeps checking on it. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["queued", "dispatched", "running"];
export const isJobActive = (job: { status: JobStatus } | null | undefined): boolean =>
  Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status));

export type PublicJob = {
  id: string;
  status: JobStatus;
  stage: string | null;
  /** 0–1 */
  progress: number | null;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Stage in plain words, percent and time left, for JobProgress. */
  progressView?: JobProgressView | null;
};

export type RangeEvidence = {
  kind:
    | "speech_block"
    | "opening_scripture"
    | "opening_phrase"
    | "closing_prayer"
    | "closing_phrase"
    | "music_before"
    | "music_after";
  atSec: number;
  segmentId?: string;
  text: string;
};

export type SermonMediaState = {
  recordingId: string;
  currentTranscriptVersion: number | null;
  suggestion: {
    status: "none" | "suggested" | "uncertain" | "failed";
    startSec: number | null;
    endSec: number | null;
    confidence: number | null;
    evidence: RangeEvidence[];
    forVersion: number | null;
  };
  confirmed: {
    startSec: number;
    endSec: number;
    by: string | null;
    at: string;
    transcriptVersion: number | null;
    /** FaithForm chose it by itself (staff can still move it). */
    automatic?: boolean;
  } | null;
  inputVersion: number;
};

export type LessonSummary = {
  sermonId: string;
  title: string;
  status: string;
  needsReview: boolean;
  reviewReason: string | null;
  stale: boolean;
};

export type RecordingOverview = {
  state: SermonMediaState;
  job: PublicJob | null;
  canPublish: boolean;
  lessons: LessonSummary[];
  clipCount: number;
  /** Clips will be made as soon as the running transcription finishes. */
  clipsQueued?: boolean;
};

export type SegmentFlag = "uncertain" | "noise" | "music" | "overlap_merged" | "edited";

export type TranscriptSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  conf?: number;
  flags?: SegmentFlag[];
};

export type TranscriptGap = {
  start: number;
  end: number;
  reason: "missing_audio" | "discontinuity" | "silence" | "music" | "noise";
};

export type Transcript = {
  version: number;
  kind: "machine" | "edited";
  language: string | null;
  durationSec: number | null;
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
};

export type ClipSummary = {
  id: string;
  origin: "suggested" | "manual";
  status: "suggested" | "draft" | "archived";
  rank: number | null;
  start_sec: number;
  end_sec: number;
  excerpt: string;
  reason: string;
  input_version: number;
  edit_version: number;
  needs_review: boolean;
  review_reason: string | null;
  updated_at: string;
};

export type Framing = { mode: "speaker" | "wide_fit" | "manual"; x?: number };

/** Caption times are seconds from the clip's start. */
export type CaptionCue = { start: number; end: number; text: string; approximate?: boolean };

export type ClipRow = ClipSummary & {
  recording_id: string;
  framing: Framing;
  captions: CaptionCue[] | null;
  captions_enabled: boolean;
  facebook_caption: string;
};

export type RenderStatus = "queued" | "rendering" | "ready" | "failed" | "superseded";

export type ReelPost = {
  id: string;
  render_id?: string;
  page_id?: string;
  page_name?: string | null;
  status: "starting" | "uploading" | "finishing" | "processing" | "needs_check" | "posted" | "failed" | string;
  permalink: string | null;
  last_error_code: string | null;
  last_error: string | null;
  created_at?: string;
  posted_at: string | null;
};

export type ClipDetail = {
  clip: ClipRow;
  sermon: SermonMediaState["confirmed"];
  inputVersion: number;
  stale: boolean;
  captions: CaptionCue[];
  captionsEdited: boolean;
  specHash: string;
  render: {
    id: string;
    status: RenderStatus;
    specHash: string;
    matchesCurrentEdit: boolean;
    validation: { ok?: boolean; problems?: string[] } | null;
    failureReason: string | null;
    job: PublicJob | null;
    previewUrl: string | null;
    downloadUrl: string | null;
    approvedAt: string | null;
  } | null;
  posts: ReelPost[];
  facebook: { connected: boolean; pageName: string | null; pageId: string | null; needsReconnect: boolean };
  canPublish: boolean;
};

/** One row of the Transcripts section (GET /api/sermon-media/library). */
export type LibraryItem = {
  id: string;
  title: string | null;
  source: "livestream" | "upload";
  recordingStatus: "processing" | "ready" | "published" | "failed" | string;
  durationSec: number | null;
  createdAt: string;
  serviceDate: string | null;
  transcript: "ready" | "none" | JobStatus;
  job: PublicJob | null;
  sermon: { startSec: number; endSec: number; automatic: boolean } | null;
  suggestion: string;
  clips: { total: number; waiting: number; scheduled: number; posted: number };
};

export type LibraryPage = { items: LibraryItem[]; total: number; page: number; pageSize: number };

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string; body: Record<string, unknown> };

const NETWORK_ERROR = "We couldn't reach FaithForm. Check your connection and try again.";

/** JSON request that never throws: a failure comes back as a plain sentence. */
export async function apiRequest<T>(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
  fallback = "Something went wrong. Please try again.",
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: init.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, error: NETWORK_ERROR, body: {} };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const error = typeof record.error === "string" && record.error.trim() ? record.error : fallback;
  const code = typeof record.code === "string" ? record.code : undefined;
  return { ok: false, status: response.status, error, code, body: record };
}

export const recordingApi = (recordingId: string) => `/api/sermon-media/recordings/${recordingId}`;
export const clipApi = (clipId: string) => `/api/sermon-media/clips/${clipId}`;

/** The untrimmed source, so transcript and clip times line up with playback. */
export function untrimmedSource(playback: { kind: "hls" | "progressive"; url: string } | null) {
  if (!playback) return null;
  return {
    kind: playback.kind,
    url: playback.kind === "hls" ? playback.url.replace(/index\.m3u8(\?|$)/, "full.m3u8$1") : playback.url,
  };
}
