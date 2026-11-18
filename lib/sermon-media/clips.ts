import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { validateReelMedia } from "@/lib/integrations/facebook-reels";
import { buildCaptionCues, rebaseCues, type CaptionCue } from "@/lib/sermon-media/captions";
import { suggestClips } from "@/lib/sermon-media/clip-suggest";
import { enqueueMediaJob, logSermonMedia, type MediaJobRow } from "@/lib/sermon-media/jobs";
import { resolveWorkerSources } from "@/lib/sermon-media/sources";
import type { SermonMediaState } from "@/lib/sermon-media/store";
import { segmentsInRange, type Transcript } from "@/lib/sermon-media/transcript";

export const CLIPS_BUCKET = "sermon-clips";
export const REEL_MIN_SEC = 3;
export const REEL_MAX_SEC = 90;

export type Framing = { mode: "speaker" | "wide_fit" | "manual"; x?: number };

export type ClipRow = {
  id: string;
  church_id: string;
  recording_id: string;
  input_version: number;
  origin: "suggested" | "manual";
  status: "suggested" | "draft" | "archived";
  rank: number | null;
  start_sec: number;
  end_sec: number;
  excerpt: string;
  reason: string;
  signals: Record<string, number>;
  framing: Framing;
  captions: CaptionCue[] | null;
  captions_enabled: boolean;
  facebook_caption: string;
  edit_version: number;
  needs_review: boolean;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type RenderRow = {
  id: string;
  church_id: string;
  clip_id: string;
  edit_version: number;
  spec_hash: string;
  spec: RenderSpec;
  status: "queued" | "rendering" | "ready" | "failed" | "superseded";
  storage_path: string | null;
  byte_size: number | null;
  media: Record<string, unknown>;
  validation: { ok?: boolean; problems?: string[] };
  failure_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export type RenderSpec = {
  start_sec: number;
  end_sec: number;
  framing: Framing;
  captions: CaptionCue[];
  captions_enabled: boolean;
  output: { width: 1080; height: 1920; fps: 30 };
};

export class ClipRuleError extends Error {}

/** Server-side bounds: inside the confirmed sermon and a valid Reel length. */
export function assertClipBounds(state: SermonMediaState, startSec: number, endSec: number): void {
  if (!state.confirmed) throw new ClipRuleError("Confirm where the sermon starts and ends first.");
  const { startSec: from, endSec: to } = state.confirmed;
  if (!(startSec >= from - 0.001 && endSec <= to + 0.001)) {
    throw new ClipRuleError("A clip has to stay inside the confirmed sermon.");
  }
  const length = endSec - startSec;
  if (length < REEL_MIN_SEC || length > REEL_MAX_SEC) {
    throw new ClipRuleError(`A Facebook Reel must be between ${REEL_MIN_SEC} and ${REEL_MAX_SEC} seconds.`);
  }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function renderSpecFor(clip: ClipRow, transcript: Transcript | null): RenderSpec {
  const start = round3(Number(clip.start_sec));
  const end = round3(Number(clip.end_sec));
  const captions =
    clip.captions ??
    (transcript ? buildCaptionCues(segmentsInRange(transcript.segments, start, end), start, end) : []);
  return {
    start_sec: start,
    end_sec: end,
    framing: clip.framing,
    captions: clip.captions_enabled ? captions : [],
    captions_enabled: clip.captions_enabled,
    output: { width: 1080, height: 1920, fps: 30 },
  };
}

export function specHash(spec: RenderSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

/** Replace untouched suggestions built from an older input with fresh ones. */
export async function refreshSuggestedClips(
  db: SupabaseClient,
  churchId: string,
  recordingId: string,
  state: SermonMediaState,
  transcript: Transcript,
): Promise<number> {
  if (!state.confirmed) throw new ClipRuleError("Confirm where the sermon starts and ends first.");
  const inRange = segmentsInRange(transcript.segments, state.confirmed.startSec, state.confirmed.endSec);
  const suggestions = suggestClips({
    segments: inRange,
    gaps: transcript.gaps,
    audioEvents: transcript.audioEvents,
    rangeStartSec: state.confirmed.startSec,
    rangeEndSec: state.confirmed.endSec,
  });
  await db
    .from("sermon_clips")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("church_id", churchId)
    .eq("recording_id", recordingId)
    .eq("status", "suggested");
  if (suggestions.length === 0) return 0;
  const { error } = await db.from("sermon_clips").insert(
    suggestions.map((suggestion, index) => ({
      church_id: churchId,
      recording_id: recordingId,
      input_version: state.inputVersion,
      origin: "suggested",
      status: "suggested",
      rank: index + 1,
      start_sec: suggestion.startSec,
      end_sec: suggestion.endSec,
      excerpt: suggestion.excerpt,
      reason: suggestion.reason,
      signals: suggestion.signals,
    })),
  );
  if (error) throw new Error(`Could not save clip suggestions: ${error.message}`);
  return suggestions.length;
}

export const clipPatchSchema = z.object({
  expectedEditVersion: z.number().int().min(1),
  startSec: z.number().finite().min(0).optional(),
  endSec: z.number().finite().min(0).optional(),
  framing: z
    .object({ mode: z.enum(["speaker", "wide_fit", "manual"]), x: z.number().min(0).max(1).optional() })
    .optional(),
  captions: z
    .array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(200) }))
    .max(400)
    .nullable()
    .optional(),
  captionsEnabled: z.boolean().optional(),
  facebookCaption: z.string().max(2200).optional(),
  status: z.enum(["draft", "archived"]).optional(),
});

/**
 * Applies a staff edit. Anything that changes the rendered video bumps
 * `edit_version`, which supersedes earlier renders and any approval of them.
 * Optimistic on edit_version so two editors cannot silently overwrite.
 */
export async function updateClip(
  db: SupabaseClient,
  clip: ClipRow,
  state: SermonMediaState,
  patch: z.infer<typeof clipPatchSchema>,
): Promise<ClipRow | null> {
  const start = patch.startSec ?? Number(clip.start_sec);
  const end = patch.endSec ?? Number(clip.end_sec);
  const trimChanged = start !== Number(clip.start_sec) || end !== Number(clip.end_sec);
  if (trimChanged || patch.status !== "archived") assertClipBounds(state, start, end);

  let captions = patch.captions === undefined ? clip.captions : patch.captions;
  if (trimChanged && patch.captions === undefined && clip.captions) {
    // Keep staff corrections aligned with the words after a trim change.
    captions = rebaseCues(clip.captions, Number(clip.start_sec), start, end - start);
  }
  if (captions) {
    for (const cue of captions) {
      if (cue.end <= cue.start || cue.end > end - start + 0.05) {
        throw new ClipRuleError("A caption line falls outside the clip. Adjust its timing.");
      }
    }
  }
  const affectsRender =
    trimChanged ||
    patch.framing !== undefined ||
    patch.captions !== undefined ||
    (patch.captionsEnabled !== undefined && patch.captionsEnabled !== clip.captions_enabled);

  const next = {
    start_sec: start,
    end_sec: end,
    framing: patch.framing ?? clip.framing,
    captions,
    captions_enabled: patch.captionsEnabled ?? clip.captions_enabled,
    facebook_caption: patch.facebookCaption ?? clip.facebook_caption,
    status: patch.status ?? (clip.status === "suggested" ? "draft" : clip.status),
    edit_version: affectsRender ? clip.edit_version + 1 : clip.edit_version,
    // Re-trimming against the current sermon is the review the flag asked for.
    ...(trimChanged && clip.needs_review ? { needs_review: false, review_reason: null, input_version: state.inputVersion } : {}),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("sermon_clips")
    .update(next)
    .eq("id", clip.id)
    .eq("church_id", clip.church_id)
    .eq("edit_version", patch.expectedEditVersion)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`Could not save the clip: ${error.message}`);
  if (!data) return null;
  if (affectsRender) {
    await db
      .from("sermon_clip_renders")
      .update({ status: "superseded", updated_at: new Date().toISOString() })
      .eq("clip_id", clip.id)
      .lt("edit_version", data.edit_version)
      .in("status", ["queued", "rendering", "ready"]);
  }
  return data as ClipRow;
}

/** Queue a render of the clip's current edit (idempotent per edit version). */
export async function requestRender(
  db: SupabaseClient,
  clip: ClipRow,
  state: SermonMediaState,
  transcript: Transcript | null,
  userId: string,
): Promise<RenderRow> {
  assertClipBounds(state, Number(clip.start_sec), Number(clip.end_sec));
  if (clip.input_version < state.inputVersion || clip.needs_review) {
    throw new ClipRuleError("The sermon changed since this clip was made. Check its start and end, then save it again.");
  }
  const spec = renderSpecFor(clip, transcript);
  const hash = specHash(spec);
  const { data: existing } = await db
    .from("sermon_clip_renders")
    .select("*")
    .eq("clip_id", clip.id)
    .eq("edit_version", clip.edit_version)
    .maybeSingle();
  let render = existing as RenderRow | null;
  if (render && render.status === "failed") {
    const { data } = await db
      .from("sermon_clip_renders")
      .update({ status: "queued", spec, spec_hash: hash, failure_reason: null, updated_at: new Date().toISOString() })
      .eq("id", render.id)
      .select("*")
      .single();
    render = data as RenderRow;
  }
  if (!render) {
    const { data, error } = await db
      .from("sermon_clip_renders")
      .insert({ church_id: clip.church_id, clip_id: clip.id, edit_version: clip.edit_version, spec, spec_hash: hash, created_by: userId })
      .select("*")
      .single();
    if (error) {
      // A double-click raced us to the unique (clip, edit_version) row.
      const { data: raced } = await db.from("sermon_clip_renders").select("*").eq("clip_id", clip.id).eq("edit_version", clip.edit_version).single();
      render = raced as RenderRow;
    } else {
      render = data as RenderRow;
    }
  }
  if (render.status === "queued") {
    await enqueueMediaJob(
      {
        churchId: clip.church_id,
        recordingId: clip.recording_id,
        kind: "render_clip",
        subjectId: render.id,
        dedupeKey: `render:${render.id}`,
        params: { clip_id: clip.id, edit_version: clip.edit_version },
        source: "manual",
        requestedBy: userId,
      },
      db,
    );
  }
  return render;
}

/** What the worker needs for one render, resolved now. Null when superseded. */
export async function renderJobPayload(
  db: SupabaseClient,
  job: MediaJobRow,
  recording: { id: string; sourceKind: "file" | "segments"; storagePath: string; durationSec: number | null },
) {
  const { data: render } = await db.from("sermon_clip_renders").select("*").eq("id", job.subject_id).eq("church_id", job.church_id).maybeSingle();
  if (!render || !["queued", "rendering"].includes(render.status)) return null;
  const { data: clip } = await db.from("sermon_clips").select("id, edit_version").eq("id", render.clip_id).maybeSingle();
  if (!clip || clip.edit_version !== render.edit_version) return null;

  const spec = render.spec as RenderSpec;
  // Half a second of lead-in on each side lets the worker cut frame-accurately.
  const media = await resolveWorkerSources(db, recording, {
    startSec: Math.max(0, spec.start_sec - 0.5),
    endSec: spec.end_sec + 0.5,
  });
  const storagePath = `clips/${job.church_id}/${render.clip_id}/${render.id}.mp4`;
  const { data: upload, error } = await db.storage.from(CLIPS_BUCKET).createSignedUploadUrl(storagePath, { upsert: true });
  if (error || !upload) throw new Error("Could not prepare the upload.");
  await db.from("sermon_clip_renders").update({ status: "rendering", updated_at: new Date().toISOString() }).eq("id", render.id).eq("status", "queued");
  return {
    spec,
    media,
    upload: { signed_url: upload.signedUrl, storage_path: storagePath, content_type: "video/mp4" },
  };
}

const renderResultSchema = z.object({
  attempt_id: z.string().uuid(),
  storage_path: z.string().regex(/^clips\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/),
  byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  probe: z.object({
    container: z.string(),
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    duration_sec: z.number(),
    video_codec: z.string(),
    pix_fmt: z.string().optional(),
    audio_codec: z.string().nullable().optional(),
    audio_rate: z.number().nullable().optional(),
    audio_channels: z.number().nullable().optional(),
    faststart: z.boolean().optional(),
    gop_sec: z.number().nullable().optional(),
    bitrate: z.number().nullable().optional(),
  }),
  framing_used: z.record(z.string(), z.unknown()).optional(),
  metrics: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Accepts a finished render only if it is the file we asked for, its length
 * matches the clip's trim on the recording, and it meets Reels requirements.
 */
export async function completeRenderFromWorker(
  db: SupabaseClient,
  job: MediaJobRow,
  leaseToken: string,
  attemptId: string,
  body: unknown,
): Promise<"ok" | "stale" | "invalid"> {
  const parsed = renderResultSchema.safeParse(body);
  if (!parsed.success) return "invalid";
  const result = parsed.data;
  const { data: render } = await db.from("sermon_clip_renders").select("*").eq("id", job.subject_id).maybeSingle();
  if (!render) return "stale";
  const expectedPath = `clips/${job.church_id}/${render.clip_id}/${render.id}.mp4`;
  if (result.storage_path !== expectedPath) return "invalid";

  const spec = render.spec as RenderSpec;
  const problems = [...validateReelMedia(result.probe).problems];
  const expectedLength = spec.end_sec - spec.start_sec;
  if (Math.abs(result.probe.duration_sec - expectedLength) > 0.25) {
    problems.push(`The video is ${result.probe.duration_sec.toFixed(2)} s but the clip is ${expectedLength.toFixed(2)} s.`);
  }
  const folder = expectedPath.slice(0, expectedPath.lastIndexOf("/"));
  const { data: listed } = await db.storage.from(CLIPS_BUCKET).list(folder, { search: `${render.id}.mp4` });
  const stored = listed?.find((item) => item.name === `${render.id}.mp4`);
  const storedSize = Number((stored?.metadata as { size?: number } | undefined)?.size ?? NaN);
  if (!stored) problems.push("The finished video was not found in storage.");
  else if (Number.isFinite(storedSize) && storedSize !== result.byte_size) problems.push("The stored video size does not match.");

  const ok = problems.length === 0;
  const { data: committed } = await db.rpc("commit_clip_render", {
    p_job_id: job.id,
    p_lease_token: leaseToken,
    p_attempt_id: attemptId,
    p_storage_path: result.storage_path,
    p_byte_size: result.byte_size,
    p_sha256: result.sha256,
    p_media: { ...result.probe, framing_used: result.framing_used ?? null },
    p_validation: { ok, problems },
    p_ok: ok,
    p_metrics: result.metrics,
  });
  if (!committed) return "stale";
  logSermonMedia("render_committed", { jobId: job.id, renderId: render.id, ok, problems: problems.length });
  return "ok";
}

export async function signedRenderUrl(db: SupabaseClient, render: RenderRow, download = false): Promise<string | null> {
  if (!render.storage_path || render.status !== "ready") return null;
  const { data } = await db.storage
    .from(CLIPS_BUCKET)
    .createSignedUrl(render.storage_path, 60 * 60, download ? { download: "sermon-clip.mp4" } : undefined);
  return data?.signedUrl ?? null;
}
