import { z } from "zod";

import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { fail, limit, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { logSermonMedia } from "@/lib/sermon-media/jobs";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { applyTranscriptEdits } from "@/lib/sermon-media/transcript";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "view");
  if (!allowed.ok) return allowed.response;
  const version = Number(new URL(request.url).searchParams.get("version")) || null;
  const transcript = await getTranscript(createAdminClient(), allowed.access.auth.churchId, id, version);
  if (!transcript) return fail(404, "There's no transcript for this recording yet.");
  return ok({ transcript });
}

const editSchema = z.object({
  basedOnVersion: z.number().int().min(1),
  edits: z.array(z.object({ id: z.string().regex(/^s\d{1,7}$/), text: z.string().max(4000) })).min(1).max(500),
  note: z.string().max(300).optional(),
});

/** Saves corrections as a new version; times and the machine version are kept. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const parsed = editSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read those changes.");
  const limited = await limit(`sermon-media-edit:${auth.churchId}:${auth.userId}`, 240);
  if (limited) return limited;

  try {
    const db = createAdminClient();
    const base = await getTranscript(db, auth.churchId, id, parsed.data.basedOnVersion);
    if (!base) return fail(404, "That transcript version no longer exists.");
    const applied = applyTranscriptEdits(base.segments, parsed.data.edits);
    if (!applied) return ok({ version: base.version, unchanged: true });
    const { data: version, error } = await db.rpc("save_transcript_edit", {
      p_recording_id: id,
      p_church_id: auth.churchId,
      p_based_on_version: parsed.data.basedOnVersion,
      p_segments: applied.segments,
      p_touched_start_sec: applied.touchedStartSec,
      p_touched_end_sec: applied.touchedEndSec,
      p_user_id: auth.userId,
      p_note: parsed.data.note ?? null,
    });
    if (error) throw error;
    if (version === null) {
      return fail(409, "Someone else changed this transcript. Reload to see the latest version, then make your change again.");
    }
    const state = await getSermonMediaState(db, auth.churchId, id);
    logSermonMedia("transcript_edited", { recordingId: id, version, edits: parsed.data.edits.length });
    return ok({ version, inputVersion: state.inputVersion });
  } catch (error) {
    return routeError(error, "We couldn't save your corrections. Please try again.", "transcript_edit");
  }
}
