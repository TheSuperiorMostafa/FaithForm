import { z } from "zod";

import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { renderSpecFor, specHash, type RenderRow } from "@/lib/sermon-media/clips";
import { fail, limit, ok, readJson, requireClipAccess, routeError } from "@/lib/sermon-media/http";
import { logSermonMedia } from "@/lib/sermon-media/jobs";
import { advanceReel, publishReel } from "@/lib/sermon-media/reel-runtime";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const postSchema = z.object({
  renderId: z.string().uuid(),
  /** The spec the person watched. A later edit makes this stale. */
  specHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** The Page they saw named on the confirm button. */
  pageId: z.string().regex(/^[0-9]{1,40}$/),
  caption: z.string().max(2200),
  /** "I watched the final video and it's OK to share publicly." */
  reviewed: z.literal(true),
});

/**
 * Post to Facebook. Explicit, admin-only, and bound to the exact render the
 * person watched, the Page they saw, and the caption they edited. A repeat
 * click (or a lost response and a retry) lands on the same post row and is
 * reconciled with Meta instead of uploading a second Reel.
 */
export async function POST(request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "publish");
  if (!allowed.ok) return allowed.response;
  const { clip, access } = allowed;
  const { auth } = access;
  const parsed = postSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "Please watch the final video and confirm it's OK to share before posting.");
  const limited = await limit(`sermon-media-reel:${auth.churchId}`, 30);
  if (limited) return limited;

  try {
    const db = createAdminClient();
    const [state, transcript, renderResult, integrations] = await Promise.all([
      getSermonMediaState(db, auth.churchId, clip.recording_id),
      getTranscript(db, auth.churchId, clip.recording_id),
      db.from("sermon_clip_renders").select("*").eq("id", parsed.data.renderId).eq("clip_id", clip.id).maybeSingle(),
      getIntegrationStatus(auth.churchId),
    ]);
    const render = renderResult.data as RenderRow | null;
    if (!render || render.status !== "ready" || !render.storage_path || !render.byte_size) {
      return fail(409, "This video isn't ready. Make the final video, watch it, then post.");
    }
    if (render.edit_version !== clip.edit_version || render.spec_hash !== parsed.data.specHash) {
      return fail(409, "The clip changed after this video was made. Make the final video again and watch it before posting.");
    }
    if (specHash(renderSpecFor(clip, transcript)) !== render.spec_hash) {
      return fail(409, "The captions or sermon text changed. Make the final video again and watch it before posting.");
    }
    if (clip.needs_review || clip.input_version < state.inputVersion) {
      return fail(409, "The sermon changed since this clip was made. Check the clip's start and end before posting.");
    }
    if (!state.confirmed || Number(clip.start_sec) < state.confirmed.startSec - 0.001 || Number(clip.end_sec) > state.confirmed.endSec + 0.001) {
      return fail(409, "This clip is outside the confirmed sermon.");
    }
    const facebook = (integrations as { facebook?: { connected: boolean; pageId: string | null; pageName: string | null; needsReconnect: boolean } }).facebook;
    if (!facebook?.connected || facebook.needsReconnect || !facebook.pageId) {
      return fail(409, "Reconnect your church's Facebook Page in Settings, then post again.");
    }
    if (facebook.pageId !== parsed.data.pageId) {
      return fail(409, "A different Facebook Page is connected now. Check the Page name and post again.");
    }

    const now = new Date().toISOString();
    await db
      .from("sermon_clip_renders")
      .update({ approved_by: auth.userId, approved_at: now })
      .eq("id", render.id)
      .is("approved_at", null);
    if (clip.facebook_caption !== parsed.data.caption) {
      await db.from("sermon_clips").update({ facebook_caption: parsed.data.caption, updated_at: now }).eq("id", clip.id);
    }

    const result = await publishReel(
      db,
      {
        church_id: auth.churchId,
        clip_id: clip.id,
        render_id: render.id,
        page_id: facebook.pageId,
        page_name: facebook.pageName,
        caption: parsed.data.caption,
        approved_by: auth.userId,
        approved_at: now,
        posted_by: auth.userId,
      },
      { path: render.storage_path, size: Number(render.byte_size) },
    );
    if ("pageChanged" in result) {
      return fail(409, "A different Facebook Page is connected now. Reconnect the right Page and post again.");
    }
    // Posting now is an approval too: keep the Clips queue in step.
    await db
      .from("sermon_clips")
      .update({
        approval_status: "posted",
        approved_render_id: render.id,
        approved_by: auth.userId,
        approved_at: now,
        approved_page_id: facebook.pageId,
        scheduled_for: null,
        updated_at: now,
      })
      .eq("id", clip.id);
    logSermonMedia("reel_post_requested", { clipId: clip.id, renderId: render.id, postId: result.post.id, created: result.created, outcome: result.result.outcome });
    const { data: post } = await db
      .from("facebook_reel_posts")
      .select("id, status, permalink, last_error_code, last_error, posted_at")
      .eq("id", result.post.id)
      .single();
    return ok({ post, alreadyStarted: !result.created }, result.created ? 201 : 200);
  } catch (error) {
    return routeError(error, "We couldn't post to Facebook. Your clip is saved; try again in a few minutes.", "reel_post");
  }
}

/** Check (and move forward) a post that is still processing. */
export async function GET(request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "view");
  if (!allowed.ok) return allowed.response;
  const postId = new URL(request.url).searchParams.get("post");
  if (!postId || !/^[0-9a-f-]{36}$/i.test(postId)) return fail(400, "Missing post.");
  const db = createAdminClient();
  const { data: post } = await db
    .from("facebook_reel_posts")
    .select("id, church_id, page_id, render_id, status, permalink, last_error_code, last_error, posted_at")
    .eq("id", postId)
    .eq("clip_id", clipId)
    .eq("church_id", allowed.access.auth.churchId)
    .maybeSingle();
  if (!post) return fail(404, "We couldn't find that post.");
  if (["starting", "uploading", "finishing", "processing", "needs_check"].includes(post.status) && allowed.access.auth.isAdmin) {
    try {
      await advanceReel(db, post);
    } catch {
      // The cron will try again; the current state is still accurate.
    }
  }
  const { data: fresh } = await db
    .from("facebook_reel_posts")
    .select("id, status, permalink, last_error_code, last_error, posted_at")
    .eq("id", postId)
    .single();
  return ok({ post: fresh });
}
