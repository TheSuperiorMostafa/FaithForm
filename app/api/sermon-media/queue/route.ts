import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { requireStudioAccess } from "@/lib/sermon-media/access";
import { signedRenderUrl, type ClipRow, type RenderRow } from "@/lib/sermon-media/clips";
import { fail, ok } from "@/lib/sermon-media/http";
import type { MediaJobRow } from "@/lib/sermon-media/jobs";
import { publicJob } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const VIEWS = new Set(["review", "scheduled", "posted", "skipped"]);

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
  const { data: clipRows } = await q;
  const clips = (clipRows ?? []) as ClipRow[];
  const clipIds = clips.map((clip) => clip.id);
  const recordingIds = [...new Set(clips.map((clip) => clip.recording_id))];

  const [renders, recordings, posts, jobs, integrations, counts] = await Promise.all([
    clipIds.length ? db.from("sermon_clip_renders").select("*").in("clip_id", clipIds).order("created_at", { ascending: false }) : { data: [] },
    recordingIds.length ? db.from("stream_recordings").select("id, title, created_at, deleted_at").in("id", recordingIds) : { data: [] },
    clipIds.length
      ? db.from("facebook_reel_posts").select("id, clip_id, status, permalink, last_error, posted_at, created_at").in("clip_id", clipIds).order("created_at", { ascending: false })
      : { data: [] },
    clipIds.length ? db.from("media_jobs").select("*").eq("kind", "render_clip").eq("church_id", auth.churchId).in("recording_id", recordingIds).order("created_at", { ascending: false }) : { data: [] },
    getIntegrationStatus(auth.churchId, db),
    db.from("sermon_clips").select("approval_status").eq("church_id", auth.churchId).neq("status", "archived").or("auto.eq.true,status.eq.draft,approval_status.neq.pending"),
  ]);

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
    counts: tally,
    canApprove: auth.isAdmin,
    facebook: facebook ?? { connected: false, pageName: null, pageId: null, needsReconnect: false },
  });
}
