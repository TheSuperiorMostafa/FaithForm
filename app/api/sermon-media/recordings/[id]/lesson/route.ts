import { z } from "zod";

import { aiGenerateObject } from "@/lib/ai";
import { featureAccessDenied } from "@/lib/features/guard";
import { createSermon, getChurchAISettings, getSermon, saveAsset, updateSermon } from "@/lib/queries/sermons";
import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { fail, limit, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { logSermonMedia } from "@/lib/sermon-media/jobs";
import {
  groundedLessonProblem,
  groundLesson,
  lessonSourceProblem,
  recordingLessonPrompt,
  recordingLessonSchema,
  recordingLessonSystemPrompt,
} from "@/lib/sermon-media/lesson";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { segmentsInRange } from "@/lib/sermon-media/transcript";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    /** Regenerate into this lesson (from the lesson builder). */
    sermonId: z.string().uuid().optional(),
    /** The person confirmed replacing a lesson they or a teammate edited. */
    replace: z.boolean().optional(),
  })
  .nullable();

/**
 * Open or create a lesson from the confirmed sermon, through the existing
 * lesson builder (kind "simple": same editor, print view and PDF).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "edit");
  if (!allowed.ok) return allowed.response;
  const sermonDenied = await featureAccessDenied("sermon_builder");
  if (sermonDenied) return sermonDenied;
  const { auth, recording } = allowed.access;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read that request.");
  const limited = await limit(`sermon-media-lesson:${auth.churchId}`, 20);
  if (limited) return limited;

  try {
    const db = createAdminClient();
    const [state, transcript] = await Promise.all([
      getSermonMediaState(db, auth.churchId, id),
      getTranscript(db, auth.churchId, id),
    ]);
    if (!transcript) return fail(409, "The transcript isn't ready yet.");
    if (!state.confirmed) return fail(409, "Confirm where the sermon starts and ends first.", { code: "range_required" });

    // Which lesson: the one asked for, or the latest draft from this recording.
    const { data: sources } = await db
      .from("sermon_recording_sources")
      .select("sermon_id, generated_sermon_updated_at")
      .eq("recording_id", id)
      .eq("church_id", auth.churchId)
      .order("generated_at", { ascending: false });
    const targetId = parsed.data?.sermonId ?? sources?.[0]?.sermon_id ?? null;
    let existing = targetId ? await getSermon(targetId) : null;
    if (existing && existing.church_id !== auth.churchId) existing = null;
    if (parsed.data?.sermonId && !existing) return fail(404, "We couldn't find that lesson.");

    if (existing) {
      const source = sources?.find((row) => row.sermon_id === existing!.id);
      // A shared lesson is the church's saved version: build a new draft beside it.
      if (existing.status === "published" || existing.published_at || (existing.mobile_published_at && !existing.mobile_unpublished_at)) {
        existing = null;
      } else {
        const edited =
          !source?.generated_sermon_updated_at ||
          new Date(existing.updated_at).getTime() > new Date(source.generated_sermon_updated_at).getTime() + 1000;
        if (edited && existing.outline && !parsed.data?.replace) {
          return fail(409, "This lesson has changes. Replacing it will discard them.", {
            code: "draft_edited",
            sermonId: existing.id,
          });
        }
      }
    }

    const rangeSegments = segmentsInRange(transcript.segments, state.confirmed.startSec, state.confirmed.endSec);
    const sourceProblem = lessonSourceProblem(rangeSegments);
    if (sourceProblem) return fail(422, sourceProblem, { code: "insufficient_source" });

    const settings = await getChurchAISettings(auth.churchId);
    const { object: draft, modelUsed } = await aiGenerateObject({
      churchId: auth.churchId,
      system: recordingLessonSystemPrompt({
        denomination: settings?.denomination ?? null,
        preachingStyle: settings?.preaching_style ?? null,
      }),
      prompt: recordingLessonPrompt(rangeSegments),
      schema: recordingLessonSchema,
      maxOutputTokens: 8192,
    });
    const lesson = groundLesson(draft, rangeSegments);
    const problem = groundedLessonProblem(lesson, draft);
    if (problem) return fail(422, problem, { code: "insufficient_source" });

    const serviceDate = await recordingServiceDate(db, id, recording.createdAt);
    const sermon = existing
      ? existing
      : await createSermon({
          churchId: auth.churchId,
          userId: auth.userId,
          title: lesson.outline.title,
          topic: lesson.outline.title,
          scripture_refs: lesson.scriptureRefs,
          audience: "General congregation",
          duration_min: Math.max(1, Math.round((state.confirmed.endSec - state.confirmed.startSec) / 60)),
          kind: "simple",
          builder: "lesson",
          translation: settings?.default_translation ?? null,
          sermon_date: serviceDate,
        });
    const updated = await updateSermon(sermon.id, {
      title: lesson.outline.title,
      scripture_refs: lesson.scriptureRefs,
      outline: lesson.outline,
      model_used: modelUsed,
    });
    await saveAsset({ sermonId: sermon.id, kind: "discussion_questions", payload: { questions: lesson.questions, modelUsed } });

    const { error } = await db.from("sermon_recording_sources").upsert({
      sermon_id: sermon.id,
      church_id: auth.churchId,
      recording_id: id,
      input_version: state.inputVersion,
      transcript_version: transcript.version,
      range_start_sec: state.confirmed.startSec,
      range_end_sec: state.confirmed.endSec,
      evidence: lesson.evidence,
      generated_by: auth.userId,
      generated_at: new Date().toISOString(),
      generated_sermon_updated_at: updated.updated_at,
      needs_review: false,
      review_reason: null,
    });
    if (error) throw error;

    logSermonMedia("lesson_generated", {
      recordingId: id,
      sermonId: sermon.id,
      points: lesson.outline.points.length,
      dropped: lesson.evidence.dropped,
      verifyRefs: lesson.evidence.scripture.filter((ref) => ref.status === "needs_verification").length,
    });
    return ok({ sermonId: sermon.id, created: !existing }, existing ? 200 : 201);
  } catch (error) {
    return routeError(error, "We couldn't make the lesson. Your recording and transcript are safe; please try again.", "lesson");
  }
}

async function recordingServiceDate(
  db: ReturnType<typeof createAdminClient>,
  recordingId: string,
  fallback: string,
): Promise<string> {
  const { data } = await db.from("stream_recordings").select("service_date").eq("id", recordingId).maybeSingle();
  const date = (data as { service_date?: string | null } | null)?.service_date;
  return date ?? fallback.slice(0, 10);
}
