import "server-only";

import { aiGenerateObject } from "@/lib/ai";
import { LessonStageError } from "@/lib/lesson-builder/failure";
import { createSermon, deleteSermon, getChurchAISettings, saveAsset, updateSermon } from "@/lib/queries/sermons";
import { logSermonMedia } from "@/lib/sermon-media/jobs";
import {
  groundedLessonProblem,
  groundLesson,
  lessonSourceProblem,
  lessonSourceRange,
  recordingLessonPrompt,
  recordingLessonSchema,
  recordingLessonSystemPrompt,
} from "@/lib/sermon-media/lesson";
import { getSermonMediaState, getTranscript } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export type FromSermonResult =
  | { ok: true; lessonId: string; title: string }
  | { ok: false; status: 409 | 422; error: string; code?: string };

/**
 * Output room for a full lesson from a 30–45 minute sermon (titles, summaries,
 * questions, quotations and their segment citations). 8192 could cut the JSON
 * off mid-reply on a long sermon, which failed the whole lesson.
 */
export const FROM_SERMON_MAX_OUTPUT_TOKENS = 12_000;
/**
 * Stop waiting for the model before the route's 300s limit, so a slow reply
 * ends with a logged cause and a plain message instead of a platform timeout.
 */
export const FROM_SERMON_AI_TIMEOUT_MS = 240_000;

async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new LessonStageError(name, error);
  }
}

/**
 * "New lesson → From a past sermon". The lesson is built only from the
 * sermon's transcript: the confirmed sermon range if staff set one, else the
 * detected range, else the whole recording (the model is told to keep to the
 * sermon). Nothing has to be confirmed first. The Bible passages are the ones
 * the pastor read, verified against the transcript by `groundLesson`, so they
 * are never chosen separately. Nothing is kept unless a faithful lesson came
 * back and was saved; the caller has already authorized the church, features
 * and recording. Failures are thrown as LessonStageError naming the step.
 */
export async function createLessonFromSermon(input: {
  churchId: string;
  userId: string;
  recordingId: string;
}): Promise<FromSermonResult> {
  const { churchId, userId, recordingId } = input;
  const db = createAdminClient();
  const [state, transcript] = await stage("load_transcript", () =>
    Promise.all([getSermonMediaState(db, churchId, recordingId), getTranscript(db, churchId, recordingId)]),
  );
  if (!transcript || transcript.segments.length === 0) {
    return { ok: false, status: 409, error: "This sermon doesn't have a transcript yet. Choose another sermon, or start a new lesson from Bible passages." };
  }

  const range = lessonSourceRange(state, transcript);
  const sourceProblem = lessonSourceProblem(range.segments);
  if (sourceProblem) return { ok: false, status: 422, error: sourceProblem, code: "insufficient_source" };

  const settings = await stage("settings", () => getChurchAISettings(churchId));
  const startedAt = Date.now();
  const { object: draft, modelUsed } = await stage("generate", () =>
    aiGenerateObject({
      churchId,
      system: recordingLessonSystemPrompt({
        denomination: settings?.denomination ?? null,
        preachingStyle: settings?.preaching_style ?? null,
      }),
      prompt: recordingLessonPrompt(range.segments, { wholeService: range.basis === "full" }),
      schema: recordingLessonSchema,
      maxOutputTokens: FROM_SERMON_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(FROM_SERMON_AI_TIMEOUT_MS),
    }),
  );
  const generateMs = Date.now() - startedAt;
  const lesson = groundLesson(draft, range.segments);
  const problem = groundedLessonProblem(lesson, draft);
  if (problem) return { ok: false, status: 422, error: problem, code: "insufficient_source" };

  const created = await stage("save_lesson", () =>
    createSermon({
      churchId,
      userId,
      title: lesson.outline.title,
      topic: lesson.outline.title,
      scripture_refs: lesson.scriptureRefs,
      audience: "General congregation",
      duration_min: Math.max(1, Math.round((range.endSec - range.startSec) / 60)),
      kind: "simple",
      builder: "lesson",
      translation: settings?.default_translation ?? null,
    }),
  );
  try {
    const updated = await stage("save_outline", () => updateSermon(created.id, { outline: lesson.outline, model_used: modelUsed }));
    await stage("save_questions", () =>
      saveAsset({ sermonId: created.id, kind: "discussion_questions", payload: { questions: lesson.questions, modelUsed } }),
    );
    await stage("save_source", async () => {
      const { error } = await db.from("sermon_recording_sources").upsert({
        sermon_id: created.id,
        church_id: churchId,
        recording_id: recordingId,
        input_version: state.inputVersion,
        transcript_version: transcript.version,
        range_start_sec: range.startSec,
        range_end_sec: range.endSec,
        evidence: lesson.evidence,
        generated_by: userId,
        generated_at: new Date().toISOString(),
        generated_sermon_updated_at: updated.updated_at,
        needs_review: false,
        review_reason: null,
      });
      if (error) throw error;
    });
  } catch (error) {
    // The person is told it didn't work, so don't leave a half-made lesson behind.
    await deleteSermon(created.id).catch(() => undefined);
    throw error;
  }

  logSermonMedia("lesson_generated", {
    recordingId,
    sermonId: created.id,
    from: "lesson_builder",
    range: range.basis,
    segments: range.segments.length,
    generateMs,
    points: lesson.outline.points.length,
    dropped: lesson.evidence.dropped,
    verifyRefs: lesson.evidence.scripture.filter((ref) => ref.status === "needs_verification").length,
  });
  return { ok: true, lessonId: created.id, title: lesson.outline.title };
}
