import { z } from "zod";

import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { assertClipBounds, refreshSuggestedClips } from "@/lib/sermon-media/clips";
import { fail, limit, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { kickDispatch } from "@/lib/sermon-media/jobs";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { runPipelineForRecording } from "@/lib/sermon-media/studio";
import { segmentsInRange } from "@/lib/sermon-media/transcript";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "view");
  if (!allowed.ok) return allowed.response;
  const { data } = await createAdminClient()
    .from("sermon_clips")
    .select("id, origin, status, rank, start_sec, end_sec, excerpt, reason, input_version, edit_version, needs_review, review_reason, updated_at")
    .eq("recording_id", id)
    .eq("church_id", allowed.access.auth.churchId)
    .neq("status", "archived")
    .order("status", { ascending: true })
    .order("rank", { ascending: true, nullsFirst: false })
    .order("start_sec", { ascending: true });
  return ok({ clips: data ?? [] });
}

const bodySchema = z.union([
  z.object({ action: z.literal("suggest") }),
  /** Find, caption, crop and render the best clips now (the Clips "Make clips" button). */
  z.object({ action: z.literal("make") }),
  z.object({ action: z.literal("create"), startSec: z.number().finite().min(0), endSec: z.number().finite().min(0) }),
]);

/** Suggest clips from the confirmed sermon, or start a clip at chosen times. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read that request.");
  const limited = await limit(`sermon-media-clips:${auth.churchId}`, 60);
  if (limited) return limited;

  try {
    const db = createAdminClient();
    const [state, transcript] = await Promise.all([
      getSermonMediaState(db, auth.churchId, id),
      getTranscript(db, auth.churchId, id),
    ]);
    if (!transcript) return fail(409, "The transcript isn't ready yet.");
    if (parsed.data.action === "make") {
      const result = await runPipelineForRecording(db, auth.churchId, id, { manual: true });
      if (result.status === "needs_range") {
        return fail(409, "We weren't sure where the sermon starts and ends. Choose it on the transcript, then make clips.", { code: "range_required" });
      }
      if (result.status !== "done") return fail(409, "Transcripts & Clips isn't ready for this recording yet.");
      if (result.clips > 0) await kickDispatch(["render_clip"]);
      return ok({ made: result.clips, autoConfirmed: result.autoConfirmed });
    }
    if (!state.confirmed) return fail(409, "Confirm where the sermon starts and ends first.");

    if (parsed.data.action === "suggest") {
      const count = await refreshSuggestedClips(db, auth.churchId, id, state, transcript);
      return ok({ suggested: count });
    }

    const { startSec, endSec } = parsed.data;
    assertClipBounds(state, startSec, endSec);
    const words = segmentsInRange(transcript.segments, startSec, endSec).map((segment) => segment.text).join(" ");
    const { data, error } = await db
      .from("sermon_clips")
      .insert({
        church_id: auth.churchId,
        recording_id: id,
        input_version: state.inputVersion,
        origin: "manual",
        status: "draft",
        start_sec: startSec,
        end_sec: endSec,
        excerpt: words.slice(0, 4000),
        reason: "Chosen by your team.",
        created_by: auth.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return ok({ clipId: data.id }, 201);
  } catch (error) {
    return routeError(error, "We couldn't make that clip. Please try again.", "clips");
  }
}
