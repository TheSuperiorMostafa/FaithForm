import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { buildCaptionCues } from "@/lib/sermon-media/captions";
import { clipPatchSchema, renderSpecFor, signedRenderUrl, specHash, updateClip, type RenderRow } from "@/lib/sermon-media/clips";
import { fail, ok, readJson, requireClipAccess, routeError } from "@/lib/sermon-media/http";
import { getLatestJob, getSermonMediaState, getTranscript, publicJob } from "@/lib/sermon-media/store";
import { segmentsInRange } from "@/lib/sermon-media/transcript";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** The clip editor's data: clip, current spec, latest render and its preview, posts, Page. */
export async function GET(_request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "view");
  if (!allowed.ok) return allowed.response;
  const { clip, access } = allowed;
  const db = createAdminClient();
  const [state, transcript, renders, posts, integrations] = await Promise.all([
    getSermonMediaState(db, access.auth.churchId, clip.recording_id),
    getTranscript(db, access.auth.churchId, clip.recording_id),
    db.from("sermon_clip_renders").select("*").eq("clip_id", clip.id).order("created_at", { ascending: false }).limit(5),
    db
      .from("facebook_reel_posts")
      .select("id, render_id, page_id, page_name, status, permalink, last_error_code, last_error, posted_by, approved_by, created_at, posted_at")
      .eq("clip_id", clip.id)
      .order("created_at", { ascending: false }),
    getIntegrationStatus(access.auth.churchId),
  ]);

  const spec = renderSpecFor(clip, transcript);
  const latest = (renders.data?.[0] as RenderRow | undefined) ?? null;
  const current = latest && latest.edit_version === clip.edit_version ? latest : null;
  const job = current ? await getLatestJob(db, access.auth.churchId, clip.recording_id, "render_clip", current.id) : null;
  const machineCaptions = transcript
    ? buildCaptionCues(segmentsInRange(transcript.segments, Number(clip.start_sec), Number(clip.end_sec)), Number(clip.start_sec), Number(clip.end_sec))
    : [];
  const facebook = (integrations as { facebook?: { connected: boolean; pageName: string | null; pageId: string | null; needsReconnect: boolean } }).facebook;

  return ok({
    clip,
    sermon: state.confirmed,
    inputVersion: state.inputVersion,
    stale: clip.input_version < state.inputVersion,
    captions: clip.captions ?? machineCaptions,
    captionsEdited: Boolean(clip.captions),
    specHash: specHash(spec),
    render: current
      ? {
          id: current.id,
          status: current.status === "rendering" && job?.status === "failed" ? "failed" : current.status,
          specHash: current.spec_hash,
          matchesCurrentEdit: current.spec_hash === specHash(spec),
          validation: current.validation,
          failureReason: current.failure_reason ?? (job?.status === "failed" ? job.last_error : null),
          job: publicJob(job, Number(clip.end_sec) - Number(clip.start_sec)),
          previewUrl: await signedRenderUrl(db, current),
          downloadUrl: await signedRenderUrl(db, current, true),
          approvedAt: current.approved_at,
        }
      : null,
    posts: posts.data ?? [],
    facebook: facebook
      ? { connected: facebook.connected, pageName: facebook.pageName, pageId: facebook.pageId, needsReconnect: facebook.needsReconnect }
      : { connected: false, pageName: null, pageId: null, needsReconnect: false },
    canPublish: access.auth.isAdmin,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "edit");
  if (!allowed.ok) return allowed.response;
  const parsed = clipPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read those changes.");
  try {
    const db = createAdminClient();
    const state = await getSermonMediaState(db, allowed.access.auth.churchId, allowed.clip.recording_id);
    const updated = await updateClip(db, allowed.clip, state, parsed.data);
    if (!updated) return fail(409, "Someone else changed this clip. Reload to see the latest, then make your change again.");
    return ok({ clip: updated });
  } catch (error) {
    return routeError(error, "We couldn't save the clip. Please try again.", "clip_patch");
  }
}
