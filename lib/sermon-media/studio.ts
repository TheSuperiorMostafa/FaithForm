import type { SupabaseClient } from "@supabase/supabase-js";

import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { draftCaption } from "@/lib/sermon-media/captions";
import { settingsFromRow } from "@/lib/sermon-media/settings";
import {
  ClipRuleError,
  refreshSuggestedClips,
  renderSpecFor,
  requestRender,
  specHash,
  type ClipRow,
  type RenderRow,
} from "@/lib/sermon-media/clips";
import { enqueueTranscription, logSermonMedia, type MediaJobRow } from "@/lib/sermon-media/jobs";
import { publishReel } from "@/lib/sermon-media/reel-runtime";
import { nextPostSlots } from "@/lib/sermon-media/schedule";
import { automaticSermonRange } from "@/lib/sermon-media/sermon-range";
import { getLatestJob, getSermonMediaState, getTranscript, type SermonMediaState } from "@/lib/sermon-media/store";
import type { Transcript } from "@/lib/sermon-media/transcript";

/**
 * The Transcripts & Clips studio: what happens after each service without
 * anyone asking, and how approved clips reach Facebook.
 *
 *   transcript ready (made first, by itself, when someone asks for clips)
 *     → the detected sermon range is used directly (or the whole video)
 *     → the best few clips found, captioned, cropped 9:16 and rendered
 *     → waiting in Clips for one-tap approval (someone watches each one)
 *     → approved clips post on the church's schedule
 *
 * Nothing is posted that a person has not watched and approved, and an edit
 * after approval withdraws it. Every step is idempotent and safe to repeat.
 */

export { draftCaption };

type FacebookStatus = { connected: boolean; pageId: string | null; pageName: string | null; needsReconnect: boolean };

async function facebookStatus(churchId: string, db: SupabaseClient): Promise<FacebookStatus> {
  const status = (await getIntegrationStatus(churchId, db)) as { facebook?: FacebookStatus };
  return status.facebook ?? { connected: false, pageId: null, pageName: null, needsReconnect: false };
}

/**
 * Uses FaithForm's own sermon range when nobody has set one: the detected
 * range, or the whole recording when detection found nothing. There is no
 * confirmation step; staff can still move it on the transcript page.
 */
export async function ensureSermonRange(
  db: SupabaseClient,
  churchId: string,
  recordingId: string,
  state: SermonMediaState,
  transcript: Transcript,
): Promise<{ state: SermonMediaState; autoConfirmed: boolean }> {
  if (state.confirmed) return { state, autoConfirmed: false };
  const range = automaticSermonRange({
    suggestion: state.suggestion,
    durationSec: transcript.durationSec,
    segments: transcript.segments,
  });
  if (!range) return { state, autoConfirmed: false };
  const { data: version } = await db.rpc("confirm_sermon_range", {
    p_recording_id: recordingId,
    p_church_id: churchId,
    p_start_sec: range.startSec,
    p_end_sec: range.endSec,
    p_user_id: null,
    p_expected_input_version: state.inputVersion,
  });
  if (version === null || version === undefined) {
    // Someone set it at the same moment: use theirs.
    return { state: await getSermonMediaState(db, churchId, recordingId), autoConfirmed: false };
  }
  await db.from("recording_sermon_media").update({ confirmed_automatically: true }).eq("recording_id", recordingId);
  logSermonMedia("range_auto_confirmed", { recordingId, confidence: state.suggestion.confidence, whole: range.whole });
  return { state: await getSermonMediaState(db, churchId, recordingId), autoConfirmed: true };
}

/**
 * Runs the automatic steps for one recording. `manual` is a person pressing
 * "Make clips" (or having pressed it before the transcript existed): clips are
 * made even when the church turned automatic clips off.
 */
export async function runPipelineForRecording(
  db: SupabaseClient,
  churchId: string,
  recordingId: string,
  options: { manual?: boolean } = {},
): Promise<{ status: "done" | "needs_range" | "no_transcript" | "off"; clips: number; autoConfirmed: boolean }> {
  if (!(await isChurchFeatureEnabled(churchId, "sermon_media"))) return { status: "off", clips: 0, autoConfirmed: false };
  const { data: row } = await db.from("sermon_media_settings").select("*").eq("church_id", churchId).maybeSingle();
  const settings = settingsFromRow((row as Record<string, unknown> | null) ?? null);

  const transcript = await getTranscript(db, churchId, recordingId);
  if (!transcript) return { status: "no_transcript", clips: 0, autoConfirmed: false };
  const ensured = await ensureSermonRange(db, churchId, recordingId, await getSermonMediaState(db, churchId, recordingId), transcript);
  const { state, autoConfirmed } = ensured;
  if (!state.confirmed) {
    // Only a recording with no usable length gets here.
    await markPipeline(db, recordingId, state.inputVersion);
    return { status: "needs_range", clips: 0, autoConfirmed };
  }

  let made = 0;
  const wanted = options.manual ? Math.max(settings.clipsPerService, 3) : settings.clipsPerService;
  if ((settings.autoClips || options.manual) && wanted > 0) {
    const { data: church } = await db.from("churches").select("name").eq("id", churchId).maybeSingle();
    await refreshSuggestedClips(db, churchId, recordingId, state, transcript);
    const { data: suggested } = await db
      .from("sermon_clips")
      .select("*")
      .eq("church_id", churchId)
      .eq("recording_id", recordingId)
      .eq("status", "suggested")
      .order("rank", { ascending: true })
      .limit(wanted);
    for (const clip of (suggested ?? []) as ClipRow[]) {
      const caption = clip.facebook_caption || draftCaption(clip.excerpt, (church?.name as string | undefined) ?? null);
      const { data: updated } = await db
        .from("sermon_clips")
        .update({ facebook_caption: caption, auto: true, status: "draft", updated_at: new Date().toISOString() })
        .eq("id", clip.id)
        .select("*")
        .single();
      try {
        await requestRender(db, (updated ?? clip) as ClipRow, state, transcript, null);
        made += 1;
      } catch (error) {
        logSermonMedia("auto_render_skipped", { clipId: clip.id, error: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
      }
    }
  }
  await markPipeline(db, recordingId, state.inputVersion);
  logSermonMedia("pipeline_ran", { recordingId, clips: made, autoConfirmed, manual: Boolean(options.manual) });
  return { status: "done", clips: made, autoConfirmed };
}

async function markPipeline(db: SupabaseClient, recordingId: string, inputVersion: number) {
  await db.from("recording_sermon_media").update({ pipeline_input_version: inputVersion }).eq("recording_id", recordingId);
}

/** Cron: run the pipeline once for each newly transcribed recording. */
export async function runAutoPipelines(db: SupabaseClient, limit = 5): Promise<{ ran: number }> {
  const { data } = await db
    .from("recording_sermon_media")
    .select("recording_id, church_id, stream_recordings!inner(deleted_at)")
    .not("current_transcript_version", "is", null)
    .is("pipeline_input_version", null)
    .is("stream_recordings.deleted_at", null)
    .limit(limit);
  let ran = 0;
  for (const row of data ?? []) {
    try {
      // Someone pressed "Make clips" before there was a transcript.
      const job = await getLatestJob(db, row.church_id as string, row.recording_id as string, "transcribe");
      await runPipelineForRecording(db, row.church_id as string, row.recording_id as string, {
        manual: job?.params?.[MAKE_CLIPS_PARAM] === true,
      });
      ran += 1;
    } catch (error) {
      logSermonMedia("pipeline_failed", { recordingId: row.recording_id, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
      await markPipeline(db, row.recording_id as string, -1);
    }
  }
  return { ran };
}

export const MAKE_CLIPS_PARAM = "make_clips";
const LIVE_JOB = ["queued", "dispatched", "running"];

/**
 * "Make clips" for one recording, from the video alone. With a transcript,
 * clips are found and rendered now. Without one, FaithForm transcribes first
 * (or keeps the transcription already running) and remembers the request on
 * that job, so the clips are made as soon as the words are in. Nobody has to
 * make or check a transcript first.
 */
export async function requestClips(
  db: SupabaseClient,
  input: { churchId: string; recordingId: string; userId: string; language: string },
): Promise<
  | { status: "made"; clips: number; autoConfirmed: boolean }
  | { status: "transcribing"; job: MediaJobRow }
  | { status: "needs_range" | "off" }
> {
  const { churchId, recordingId } = input;
  if (await getTranscript(db, churchId, recordingId)) {
    const result = await runPipelineForRecording(db, churchId, recordingId, { manual: true });
    if (result.status === "done") return { status: "made", clips: result.clips, autoConfirmed: result.autoConfirmed };
    if (result.status === "needs_range") return { status: "needs_range" };
    if (result.status === "off") return { status: "off" };
  }

  const previous = await getLatestJob(db, churchId, recordingId, "transcribe");
  let job = previous && LIVE_JOB.includes(previous.status) ? previous : null;
  if (!job) {
    const { data: rec } = await db
      .from("stream_recordings")
      .select("mobile_rendition_revision")
      .eq("id", recordingId)
      .eq("church_id", churchId)
      .single();
    const enqueued = await enqueueTranscription(
      {
        churchId,
        recordingId,
        revision: Number(rec?.mobile_rendition_revision ?? 0),
        language: input.language,
        source: previous ? "retry" : "manual",
        requestedBy: input.userId,
        force: true,
      },
      db,
    );
    job = enqueued.job;
  }
  if (!job) throw new Error("Could not queue the transcription for clips.");
  if (job.params?.[MAKE_CLIPS_PARAM] !== true) {
    const params = { ...(job.params ?? {}), [MAKE_CLIPS_PARAM]: true };
    await db.from("media_jobs").update({ params }).eq("id", job.id).eq("church_id", churchId);
    job = { ...job, params };
  }
  logSermonMedia("clips_requested_before_transcript", { recordingId, jobId: job.id });
  return { status: "transcribing", job };
}

/** Whether a running transcription will go on to make clips. */
export function clipsQueuedOn(job: Pick<MediaJobRow, "status" | "params"> | null): boolean {
  return Boolean(job && LIVE_JOB.includes(job.status) && job.params?.[MAKE_CLIPS_PARAM] === true);
}

/**
 * One-tap approval of a clip's final video. Checks the same things as posting
 * now: the render is the clip's current edit and the one the person watched,
 * the clip is inside the confirmed sermon, and the Page is the one connected.
 * Returns the time it will post.
 */
export async function approveClip(
  db: SupabaseClient,
  input: {
    clip: ClipRow;
    churchId: string;
    churchTimezone: string;
    userId: string;
    renderId: string;
    specHash: string;
    caption: string;
    postNow: boolean;
  },
): Promise<{ scheduledFor: string; pageName: string | null }> {
  const { clip } = input;
  const [state, transcript, renderResult, facebook] = await Promise.all([
    getSermonMediaState(db, input.churchId, clip.recording_id),
    getTranscript(db, input.churchId, clip.recording_id),
    db.from("sermon_clip_renders").select("*").eq("id", input.renderId).eq("clip_id", clip.id).maybeSingle(),
    facebookStatus(input.churchId, db),
  ]);
  const render = renderResult.data as RenderRow | null;
  if (!render || render.status !== "ready" || !render.storage_path) {
    throw new ClipRuleError("This video isn't ready yet. Wait for it to finish, watch it, then approve.");
  }
  if (render.edit_version !== clip.edit_version || render.spec_hash !== input.specHash || specHash(renderSpecFor(clip, transcript)) !== render.spec_hash) {
    throw new ClipRuleError("The clip changed after this video was made. Make the video again and watch it before approving.");
  }
  if (clip.needs_review || clip.input_version < state.inputVersion) {
    throw new ClipRuleError("The sermon changed since this clip was made. Check the clip's start and end first.");
  }
  if (!state.confirmed || Number(clip.start_sec) < state.confirmed.startSec - 0.001 || Number(clip.end_sec) > state.confirmed.endSec + 0.001) {
    throw new ClipRuleError("This clip is outside the sermon.");
  }
  if (!facebook.connected || facebook.needsReconnect || !facebook.pageId) {
    throw new ClipRuleError("Connect your church's Facebook Page in Settings first.");
  }

  let when = new Date();
  if (!input.postNow) {
    const { data: row } = await db.from("sermon_media_settings").select("post_schedule").eq("church_id", input.churchId).maybeSingle();
    const schedule = settingsFromRow((row as Record<string, unknown> | null) ?? null).postSchedule;
    const { data: taken } = await db
      .from("sermon_clips")
      .select("scheduled_for")
      .eq("church_id", input.churchId)
      .eq("approval_status", "approved")
      .not("scheduled_for", "is", null);
    const [slot] = nextPostSlots(
      schedule,
      input.churchTimezone || "America/New_York",
      (taken ?? []).map((item) => new Date(item.scheduled_for as string)),
    );
    if (slot) when = slot;
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await db
    .from("sermon_clips")
    .update({
      approval_status: "approved",
      approved_render_id: render.id,
      approved_by: input.userId,
      approved_at: now,
      approved_page_id: facebook.pageId,
      scheduled_for: when.toISOString(),
      facebook_caption: input.caption,
      status: clip.status === "suggested" ? "draft" : clip.status,
      updated_at: now,
    })
    .eq("id", clip.id)
    .eq("edit_version", clip.edit_version)
    .in("approval_status", ["pending", "skipped", "approved"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not approve the clip: ${error.message}`);
  if (!updated) throw new ClipRuleError("Someone else changed this clip. Reload and try again.");
  await db.from("sermon_clip_renders").update({ approved_by: input.userId, approved_at: now }).eq("id", render.id).is("approved_at", null);
  logSermonMedia("clip_approved", { clipId: clip.id, renderId: render.id, postNow: input.postNow });
  return { scheduledFor: when.toISOString(), pageName: facebook.pageName };
}

export async function setClipDecision(
  db: SupabaseClient,
  clip: ClipRow,
  decision: "skip" | "unschedule" | "restore",
): Promise<boolean> {
  const from = decision === "skip" ? ["pending", "approved"] : decision === "restore" ? ["skipped"] : ["approved"];
  const { data } = await db
    .from("sermon_clips")
    .update({
      approval_status: decision === "skip" ? "skipped" : "pending",
      scheduled_for: null,
      approved_render_id: null,
      approved_by: null,
      approved_at: null,
      approved_page_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clip.id)
    .in("approval_status", from)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

/**
 * Cron: post approved clips whose time has come. Re-checks everything at post
 * time; a clip that no longer qualifies goes back to waiting for approval with
 * the reason, rather than posting something nobody approved.
 */
export async function postDueClips(db: SupabaseClient, limit = 5): Promise<{ started: number; held: number }> {
  const { data } = await db
    .from("sermon_clips")
    .select("*")
    .eq("approval_status", "approved")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  let started = 0;
  let held = 0;
  const hold = async (clip: ClipRow, reason: string) => {
    held += 1;
    await db
      .from("sermon_clips")
      .update({ approval_status: "pending", scheduled_for: null, review_reason: reason.slice(0, 200), needs_review: true, updated_at: new Date().toISOString() })
      .eq("id", clip.id)
      .eq("approval_status", "approved");
    logSermonMedia("scheduled_post_held", { clipId: clip.id, reason });
  };

  for (const clip of (data ?? []) as ClipRow[]) {
    try {
      if (!(await isChurchFeatureEnabled(clip.church_id, "sermon_media"))) {
        await hold(clip, "Transcripts & Clips is turned off for this church.");
        continue;
      }
      const { data: render } = await db.from("sermon_clip_renders").select("*").eq("id", clip.approved_render_id ?? "").maybeSingle();
      const r = render as RenderRow | null;
      if (!r || r.status !== "ready" || !r.storage_path || !r.byte_size || r.edit_version !== clip.edit_version) {
        await hold(clip, "The approved video changed. Watch the new version and approve it again.");
        continue;
      }
      const facebook = await facebookStatus(clip.church_id, db);
      if (!facebook.connected || facebook.needsReconnect || facebook.pageId !== clip.approved_page_id) {
        await hold(clip, "The Facebook Page was disconnected or changed. Reconnect it and approve again.");
        continue;
      }
      const result = await publishReel(
        db,
        {
          church_id: clip.church_id,
          clip_id: clip.id,
          render_id: r.id,
          page_id: facebook.pageId!,
          page_name: facebook.pageName,
          caption: clip.facebook_caption,
          approved_by: clip.approved_by!,
          approved_at: clip.approved_at!,
          posted_by: clip.approved_by!,
        },
        { path: r.storage_path, size: Number(r.byte_size) },
      );
      if ("pageChanged" in result) {
        await hold(clip, "The Facebook Page changed. Reconnect it and approve again.");
        continue;
      }
      await db.from("sermon_clips").update({ approval_status: "posted", updated_at: new Date().toISOString() }).eq("id", clip.id).eq("approval_status", "approved");
      started += 1;
      logSermonMedia("scheduled_post_started", { clipId: clip.id, postId: result.post.id, outcome: result.result.outcome });
    } catch (error) {
      // Transient (network, Meta 5xx): try again in 15 minutes.
      await db
        .from("sermon_clips")
        .update({ scheduled_for: new Date(Date.now() + 15 * 60_000).toISOString() })
        .eq("id", clip.id)
        .eq("approval_status", "approved");
      logSermonMedia("scheduled_post_retry", { clipId: clip.id, error: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    }
  }
  return { started, held };
}
