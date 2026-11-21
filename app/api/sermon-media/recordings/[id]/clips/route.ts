import { z } from "zod";

import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { assertClipBounds, refreshSuggestedClips } from "@/lib/sermon-media/clips";
import { fail, limit, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { kickDispatch } from "@/lib/sermon-media/jobs";
import { getSermonMediaState, getTranscript, publicJob } from "@/lib/sermon-media/store";
import { NO_MOMENTS_MESSAGE } from "@/lib/sermon-media/clip-requests";
import { ensureSermonRange, requestClips } from "@/lib/sermon-media/studio";
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
  /** Find, caption, crop and render the best clips (transcribing first when needed). */
  z.object({ action: z.literal("make") }),
  z.object({ action: z.literal("create"), startSec: z.number().finite().min(0), endSec: z.number().finite().min(0) }),
]);

/**
 * Make clips from the recording (transcribing it first if needed), suggest
 * clips, or start a clip at chosen times. None of these wait for anyone to
 * confirm the sermon: FaithForm uses the range it found.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const { auth, recording, settings } = allowed.access;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read that request.");
  const limited = await limit(`sermon-media-clips:${auth.churchId}`, 60);
  if (limited) return limited;

  try {
    const db = createAdminClient();
    if (parsed.data.action === "make") {
      if (!["ready", "published"].includes(recording.status)) {
        return fail(409, "This recording isn't ready yet. You can make clips once it has finished processing.");
      }
      const result = await requestClips(db, {
        churchId: auth.churchId,
        recordingId: id,
        userId: auth.userId,
        language: settings.language,
      });
      if (result.status === "transcribing") {
        await kickDispatch(["transcribe"]);
        return ok({ made: 0, transcribing: true, job: publicJob(result.job, recording.durationSec ?? 0) }, 202);
      }
      if (result.status === "needs_range") return fail(409, "This video is too short to make clips from.");
      if (result.status !== "made") return fail(409, "Transcripts & Clips isn't ready for this recording yet.");
      if (result.renders > 0) await kickDispatch(["render_clip"]);
      if (result.clips === 0) {
        // Say so plainly rather than report success with nothing to show.
        const { count } = await db
          .from("sermon_clips")
          .select("id", { count: "exact", head: true })
          .eq("church_id", auth.churchId)
          .eq("recording_id", id)
          .neq("status", "archived")
          .neq("status", "suggested");
        if (!count) return fail(422, NO_MOMENTS_MESSAGE);
        return ok({ made: 0, existing: count, autoConfirmed: result.autoConfirmed });
      }
      return ok({ made: result.clips, autoConfirmed: result.autoConfirmed });
    }

    const transcript = await getTranscript(db, auth.churchId, id);
    if (!transcript) return fail(409, "The transcript isn't ready yet.");
    const { state } = await ensureSermonRange(db, auth.churchId, id, await getSermonMediaState(db, auth.churchId, id), transcript);
    if (!state.confirmed) return fail(409, "This video is too short to make clips from.");

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
