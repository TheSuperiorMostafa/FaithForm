import { z } from "zod";

import { parseScriptureRef } from "@/lib/sermon-builder/parse-ref";

/**
 * What "New lesson" sends to `POST /api/lessons`. A lesson starts one of two
 * ways, and nothing else is asked for (no series, no lesson date):
 *
 *   "sermon"    — from a past sermon: the recording whose transcript the
 *                 lesson is built from. The Bible passages come from what the
 *                 pastor read, so they are not chosen here.
 *   "scripture" — a new lesson: a title and the Bible passages it teaches.
 *
 * A request without `source` is a new lesson from Scripture, as before; old
 * `sermon_date` / `series_id` fields are ignored.
 */
const fromSermonSchema = z.object({
  source: z.literal("sermon"),
  recording_id: z.string().uuid("Choose one of your past sermons."),
});

const fromScriptureSchema = z.object({
  source: z.literal("scripture"),
  title: z.string().trim().min(1, "Give the lesson a title.").max(140),
  scripture_refs: z
    .array(z.string().trim().min(1).max(60))
    .min(1, "Add at least one Bible passage.")
    .max(10),
  translation: z.string().trim().min(1).max(20),
});

export const newLessonRequestSchema = z.discriminatedUnion("source", [fromSermonSchema, fromScriptureSchema]);

export type NewLessonRequest = z.infer<typeof newLessonRequestSchema>;

export function parseNewLessonRequest(
  body: unknown,
): { ok: true; data: NewLessonRequest } | { ok: false; error: string } {
  const withSource =
    body && typeof body === "object" && !Array.isArray(body) && !("source" in body)
      ? { ...(body as Record<string, unknown>), source: "scripture" }
      : body;
  const parsed = newLessonRequestSchema.safeParse(withSource);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the lesson details." };
  }
  if (parsed.data.source === "scripture") {
    const unreadable = parsed.data.scripture_refs.find((ref) => !parseScriptureRef(ref));
    if (unreadable) return { ok: false, error: `We couldn't read the passage "${unreadable}".` };
  }
  return { ok: true, data: parsed.data };
}
