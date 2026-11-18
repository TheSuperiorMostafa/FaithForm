import { requestRender } from "@/lib/sermon-media/clips";
import { limit, ok, requireClipAccess, routeError } from "@/lib/sermon-media/http";
import { kickDispatch } from "@/lib/sermon-media/jobs";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Make the final video for the clip's current edit. Repeat clicks reuse it. */
export async function POST(_request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "edit");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const limited = await limit(`sermon-media-render:${auth.churchId}`, 60);
  if (limited) return limited;
  try {
    const db = createAdminClient();
    const [state, transcript] = await Promise.all([
      getSermonMediaState(db, auth.churchId, allowed.clip.recording_id),
      getTranscript(db, auth.churchId, allowed.clip.recording_id),
    ]);
    const render = await requestRender(db, allowed.clip, state, transcript, auth.userId);
    if (render.status === "queued") await kickDispatch(["render_clip"]);
    return ok({ renderId: render.id, status: render.status }, 202);
  } catch (error) {
    return routeError(error, "We couldn't start making the video. Please try again.", "render");
  }
}
