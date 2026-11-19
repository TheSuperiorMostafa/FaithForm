import { z } from "zod";

import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { fail, limit, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { enqueueTranscription, kickDispatch, requestJobCancel } from "@/lib/sermon-media/jobs";
import { getLatestJob, publicJob } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ redo: z.boolean().optional() }).nullable();

/**
 * Start transcription for an existing recording, or retry one that failed.
 * `redo` replaces an existing transcript with a fresh machine version (staff
 * edits stay in the version history, and drafts built on them are flagged).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const { auth, recording, settings } = allowed.access;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read that request.");
  if (!["ready", "published"].includes(recording.status)) {
    return fail(409, "This recording isn't ready yet. Transcription starts once it has finished processing.");
  }
  const limited = await limit(`sermon-media-transcribe:${auth.churchId}`, 20);
  if (limited) return limited;

  try {
    const db = createAdminClient();
    const previous = await getLatestJob(db, auth.churchId, id, "transcribe");
    if (previous && ["queued", "dispatched", "running"].includes(previous.status)) {
      return ok({ job: publicJob(previous, allowed.access.recording.durationSec ?? 0) });
    }
    if (previous?.status === "succeeded" && !parsed.data?.redo) {
      return fail(409, "This recording already has a transcript.");
    }
    const { data: rec } = await db.from("stream_recordings").select("mobile_rendition_revision").eq("id", id).single();
    const { job } = await enqueueTranscription(
      {
        churchId: auth.churchId,
        recordingId: id,
        revision: Number(rec?.mobile_rendition_revision ?? 0),
        language: settings.language,
        source: previous ? "retry" : "manual",
        requestedBy: auth.userId,
        force: true,
      },
      db,
    );
    await kickDispatch(["transcribe"]);
    const latest = job ? await getLatestJob(db, auth.churchId, id, "transcribe") : null;
    return ok({ job: publicJob(latest ?? job, allowed.access.recording.durationSec ?? 0) }, 202);
  } catch (error) {
    return routeError(error, "We couldn't start the transcript. Please try again.", "transcribe");
  }
}

/** Stop a queued or running transcription. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const db = createAdminClient();
  const job = await getLatestJob(db, allowed.access.auth.churchId, id, "transcribe");
  if (!job || !["queued", "dispatched", "running"].includes(job.status)) return ok({ job: publicJob(job) });
  await requestJobCancel(job.id, allowed.access.auth.churchId, db);
  return ok({ job: publicJob(await getLatestJob(db, allowed.access.auth.churchId, id, "transcribe")) });
}
