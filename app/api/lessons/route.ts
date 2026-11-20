import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireChurchAuth } from "@/lib/auth/church";
import { normalizeTranslationId } from "@/lib/bible/translations";
import { featureAccessDenied } from "@/lib/features/guard";
import { parseNewLessonRequest } from "@/lib/lesson-builder/create-lesson";
import { createLessonFromSermon } from "@/lib/lesson-builder/from-sermon";
import { createSermon } from "@/lib/queries/sermons";
import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { limit } from "@/lib/sermon-media/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const START_FAILED = "We couldn't start the lesson. Please try again.";
const FROM_SERMON_FAILED = "We couldn't make the lesson from this sermon. The sermon and its transcript are safe; please try again.";

/**
 * Lesson Builder: start a new lesson one of two ways.
 *
 *   From a past sermon — built here from that sermon's transcript only; its
 *   Bible passages come from the sermon. Returns the finished lesson.
 *   From Bible passages — creates the lesson record (title, passages,
 *   translation); the lesson is then written by the existing
 *   `/api/sermon/outline` call, so the editor, print view and PDF are the ones
 *   the sermon builder already uses.
 *
 * No series or lesson date is asked for; those columns stay empty.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;

    const parsed = parseNewLessonRequest(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.data;

    if (input.source === "sermon") {
      const allowed = await requireRecordingAccess(input.recording_id, "edit");
      if (!allowed.ok) return allowed.response;
      const limited = await limit(`sermon-media-lesson:${auth.churchId}`, 20);
      if (limited) return limited;
      const result = await createLessonFromSermon({
        churchId: auth.churchId,
        userId: auth.userId,
        recordingId: input.recording_id,
      }).catch((error: unknown) => {
        console.error("lesson from sermon failed", error instanceof Error ? error.message : error);
        return { ok: false as const, status: 500 as const, error: FROM_SERMON_FAILED, code: undefined };
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}) }, { status: result.status });
      }
      revalidatePath("/dashboard/lesson-builder");
      return NextResponse.json({ lessonId: result.lessonId, title: result.title, written: true }, { status: 201 });
    }

    const lesson = await createSermon({
      churchId: auth.churchId,
      userId: auth.userId,
      title: input.title,
      topic: input.title,
      scripture_refs: input.scripture_refs,
      audience: "General congregation",
      duration_min: 30,
      kind: "simple",
      builder: "lesson",
      translation: normalizeTranslationId(input.translation),
    });
    revalidatePath("/dashboard/lesson-builder");
    return NextResponse.json({ lessonId: lesson.id, written: false }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }
    console.error("lesson create failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: START_FAILED }, { status: 500 });
  }
}
