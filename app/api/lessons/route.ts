import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireChurchAuth } from "@/lib/auth/church";
import { normalizeTranslationId } from "@/lib/bible/translations";
import { featureAccessDenied } from "@/lib/features/guard";
import { createSermon } from "@/lib/queries/sermons";
import { parseScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lesson Builder: create a lesson record with the same creation options as a
 * sermon (title, passages, translation, date, series). The lesson itself is
 * then written by the existing `/api/sermon/outline` call, so the editor,
 * print view and PDF are the ones the sermon builder already uses.
 */
const bodySchema = z.object({
  title: z.string().trim().min(1, "Give the lesson a title.").max(140),
  scripture_refs: z.array(z.string().trim().min(1).max(60)).min(1, "Add at least one Bible passage.").max(10),
  translation: z.string().trim().min(1).max(20),
  sermon_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  series_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the lesson details." }, { status: 400 });
    }
    const input = parsed.data;
    const unreadable = input.scripture_refs.find((ref) => !parseScriptureRef(ref));
    if (unreadable) {
      return NextResponse.json({ error: `We couldn't read the passage "${unreadable}".` }, { status: 400 });
    }

    let seriesId: string | null = null;
    if (input.series_id) {
      const { data } = await createAdminClient()
        .from("sermon_series")
        .select("id")
        .eq("id", input.series_id)
        .eq("church_id", auth.churchId)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: "Choose one of your church's series." }, { status: 400 });
      seriesId = data.id as string;
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
      sermon_date: input.sermon_date ?? null,
      series_id: seriesId,
    });
    revalidatePath("/dashboard/lesson-builder");
    return NextResponse.json({ lessonId: lesson.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    }
    console.error("lesson create failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "We couldn't start the lesson. Please try again." }, { status: 500 });
  }
}
