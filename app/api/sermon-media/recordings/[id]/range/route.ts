import { z } from "zod";

import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { fail, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { logSermonMedia } from "@/lib/sermon-media/jobs";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  startSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0),
  expectedInputVersion: z.number().int().min(0),
});

const MIN_SERMON_SEC = 60;

/** Confirm (or move) the sermon's start and end. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read that start and end.");
  const { startSec, endSec, expectedInputVersion } = parsed.data;

  try {
    const db = createAdminClient();
    const transcript = await getTranscript(db, auth.churchId, id);
    if (!transcript) return fail(409, "The transcript isn't ready yet.");
    const total = transcript.durationSec ?? allowed.access.recording.durationSec ?? Number.POSITIVE_INFINITY;
    if (endSec <= startSec) return fail(422, "The sermon has to end after it starts.");
    if (endSec - startSec < MIN_SERMON_SEC) return fail(422, "The sermon has to be at least a minute long.");
    if (endSec > total + 1) return fail(422, "The end is past the end of the recording.");

    const round = (value: number) => Math.round(value * 1000) / 1000;
    const { data: version, error } = await db.rpc("confirm_sermon_range", {
      p_recording_id: id,
      p_church_id: auth.churchId,
      p_start_sec: round(startSec),
      p_end_sec: round(Math.min(endSec, total)),
      p_user_id: auth.userId,
      p_expected_input_version: expectedInputVersion,
    });
    if (error) throw error;
    if (version === null) {
      return fail(409, "Someone else just changed the sermon range or transcript. Reload to see it, then confirm again.");
    }
    logSermonMedia("range_confirmed", { recordingId: id, inputVersion: version });
    return ok({ state: await getSermonMediaState(db, auth.churchId, id) });
  } catch (error) {
    return routeError(error, "We couldn't save the sermon range. Please try again.", "range");
  }
}
