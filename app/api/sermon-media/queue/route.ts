import type { SupabaseClient } from "@supabase/supabase-js";

import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { requireStudioAccess } from "@/lib/sermon-media/access";
import { signedRenderUrl, type ClipRow, type RenderRow } from "@/lib/sermon-media/clips";
import { fail, ok } from "@/lib/sermon-media/http";
import { describeClipRequests, type ClipRequestJob, type ClipRequestView } from "@/lib/sermon-media/clip-requests";
import { logSermonMedia, type MediaJobRow } from "@/lib/sermon-media/jobs";
import { MAKE_CLIPS_PARAM } from "@/lib/sermon-media/studio";
import { publicJob } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const VIEWS = new Set(["review", "scheduled", "posted", "skipped"]);

/**
 * A failed read must not look like an empty queue: "No clips waiting" after
 * someone made clips is exactly the wrong answer.
 */
function loadFailed(step: string, message: string) {
  logSermonMedia("clips_queue_failed", { step, error: message.slice(0, 160) });
  return fail(500, "We couldn't load your clips. Please try again in a minute.");
}

/** Make clips requests still on their way, or stopped, for Ready to review. */
async function loadClipRequests(db: SupabaseClient, churchId: string): Promise<ClipRequestView[]> {
  try {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data: jobRows, error } = await db
      .from("media_jobs")
      .select("recording_id, kind, status, stage, progress, created_at, dispatched_at, started_at, finished_at, updated_at, last_error_code")
      .eq("church_id", churchId)
      .eq("kind", "transcribe")
      .contains("params", { [MAKE_CLIPS_PARAM]: true })
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const jobs = (jobRows ?? []) as ClipRequestJob[];
    const ids = [...new Set(jobs.map((job) => job.recording_id))];
    if (ids.length === 0) return [];
    const [recordings, states, clips] = await Promise.all([
      db.from("stream_recordings").select("id, title, duration_sec, deleted_at").eq("church_id", churchId).in("id", ids),
      db.from("recording_sermon_media").select("recording_id, current_transcript_version, pipeline_input_version").eq("church_id", churchId).in("recording_id", ids),
      db.from("sermon_clips").select("recording_id").eq("church_id", churchId).in("recording_id", ids).neq("status", "archived").neq("status", "suggested"),
    ]);
    const failed = recordings.error ?? states.error ?? clips.error;
    if (failed) throw new Error(failed.message);
    const clipCounts = new Map<string, number>();
    for (const row of clips.data ?? []) clipCounts.set(row.recording_id as string, (clipCounts.get(row.recording_id as string) ?? 0) + 1);
    return describeClipRequests({
      jobs,
      recordings: new Map(
        (recordings.data ?? []).map((row) => [
          row.id as string,
          { title: row.title as string | null, durationSec: row.duration_sec === null ? null : Number(row.duration_sec), deleted: Boolean(row.deleted_at) },
        ]),
      ),
      states: new Map(
        (states.data ?? []).map((row) => [
          row.recording_id as string,
          {
            transcriptVersion: row.current_transcript_version === null ? null : Number(row.current_transcript_version),
            pipelineVersion: row.pipeline_input_version === null ? null : Number(row.pipeline_input_version),
          },
        ]),
      ),
      clipCounts,
    });
  } catch (error) {
    // The clips themselves still load; only this summary is missing.
    logSermonMedia("clip_requests_failed", { error: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    return [];
  }
}

/**
 * Clips section: clips across every recording.
 *   review    — waiting for approval (ready to watch, or still being made)
 *   scheduled — approved, with the time each will post
 *   posted    — handed to Facebook, with live post status and link
 *   skipped   — set aside
 */
export async function GET(request: Request) {
  const allowed = await requireStudioAccess("view");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const view = new URL(request.url).searchParams.get("view") ?? "review";
  if (!VIEWS.has(view)) return fail(400, "Unknown view.");
  const db = createAdminClient();

  const statusFor: Record<string, string> = { review: "pending", scheduled: "approved", posted: "posted", skipped: "skipped" };
  let q = db
    .from("sermon_clips")
    .select("*")
    .eq("church_id", auth.churchId)
    .eq("approval_status", statusFor[view])
    .limit(60);
  // Review only shows clips someone chose or FaithForm prepared, not every raw suggestion.
  q = view === "review" ? q.neq("status", "archived").or("auto.eq.true,status.eq.draft") : q.neq("status", "archived");
  q = view === "scheduled" ? q.order("scheduled_for", { ascending: true }) : q.order("updated_at", { ascending: false });
  const { data: clipRows, error: clipsError } = await q;
  if (clipsError) return loadFailed("clips", clipsError.message);
  const clips = (clipRows ?? []) as ClipRow[];
  const clipIds = clips.map((clip) => clip.id);
  const recordingIds = [...new Set(clips.map((clip) => clip.recording_id))];

  const [renders, recordings, posts, jobs, integrations, counts, requests] = await Promise.all([
    clipIds.length ? db.from("sermon_clip_renders").select("*").in("clip_id", clipIds).order("created_at", { ascending: false }) : { data: [] },
    recordingIds.length ? db.from("stream_recordings").select("id, title, created_at, deleted_at").in("id", recordingIds) : { data: [] },
    clipIds.length
      ? db.from("facebook_reel_posts").select("id, clip_id, status, permalink, last_error, posted_at, created_at").in("clip_id", clipIds).order("created_at", { ascending: false })
      : { data: [] },
    clipIds.length ? db.from("media_jobs").select("*").eq("kind", "render_clip").eq("church_id", auth.churchId).in("recording_id", recordingIds).order("created_at", { ascending: false }) : { data: [] },
    getIntegrationStatus(auth.churchId, db),
    db.from("sermon_clips").select("approval_status").eq("church_id", auth.churchId).neq("status", "archived").or("auto.eq.true,status.eq.draft,approval_status.neq.pending"),
    view === "review" ? loadClipRequests(db, auth.churchId) : Promise.resolve([]),
  ]);
  if (counts.error) return loadFailed("counts", counts.error.message);

  const renderBy = new Map<string, RenderRow>();
  for (const render of (renders.data ?? []) as RenderRow[]) if (!renderBy.has(render.clip_id)) renderBy.set(render.clip_id, render);
  const recordingBy = new Map((recordings.data ?? []).map((row) => [row.id as string, row]));
  const postBy = new Map<string, Record<string, unknown>>();
  for (const post of posts.data ?? []) if (!postBy.has(post.clip_id as string)) postBy.set(post.clip_id as string, post);
  const jobBy = new Map<string, MediaJobRow>();
  for (const job of (jobs.data ?? []) as MediaJobRow[]) if (!jobBy.has(job.subject_id)) jobBy.set(job.subject_id, job);

  const items = [];
  for (const clip of clips) {
    const recording = recordingBy.get(clip.recording_id);
    if (!recording || recording.deleted_at) continue;
    const render = renderBy.get(clip.id) ?? null;
    const current = render && render.edit_version === clip.edit_version ? render : null;
    const job = current ? jobBy.get(current.id) ?? null : null;
    items.push({
      id: clip.id,
      recordingId: clip.recording_id,
      recordingTitle: recording.title,
      recordingDate: recording.created_at,
      startSec: Number(clip.start_sec),
      endSec: Number(clip.end_sec),
      excerpt: clip.excerpt,
      reason: clip.reason,
      caption: clip.facebook_caption,
      auto: clip.auto,
      editVersion: clip.edit_version,
      needsReview: clip.needs_review,
      reviewReason: clip.review_reason,
      approvalStatus: clip.approval_status,
      scheduledFor: clip.scheduled_for,
      render: current
        ? {
            id: current.id,
            status: current.status === "rendering" && job?.status === "failed" ? "failed" : current.status,
            specHash: current.spec_hash,
            // Approval re-checks the exact spec (captions included) on the server.
            matchesCurrentEdit: true,
            previewUrl: await signedRenderUrl(db, current),
            downloadUrl: await signedRenderUrl(db, current, true),
            failureReason: current.failure_reason ?? (job?.status === "failed" ? job.last_error : null),
            job: publicJob(job, Number(clip.end_sec) - Number(clip.start_sec)),
          }
        : null,
      post: postBy.get(clip.id) ?? null,
    });
  }

  const tally = { review: 0, scheduled: 0, posted: 0, skipped: 0 };
  for (const row of counts.data ?? []) {
    const status = row.approval_status as string;
    if (status === "pending") tally.review += 1;
    if (status === "approved") tally.scheduled += 1;
    if (status === "posted") tally.posted += 1;
    if (status === "skipped") tally.skipped += 1;
  }
  const facebook = (integrations as { facebook?: { connected: boolean; pageName: string | null; pageId: string | null; needsReconnect: boolean } }).facebook;
  return ok({
    view,
    items,
    requests,
    counts: tally,
    canApprove: auth.isAdmin,
    facebook: facebook ?? { connected: false, pageName: null, pageId: null, needsReconnect: false },
  });
}
