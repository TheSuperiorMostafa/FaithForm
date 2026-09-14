import type { SermonContent } from "@/types/sermon";

/**
 * Which sermon columns a request may change, as pure functions.
 *
 * `PATCH /api/sermon/[id]` used to hand its JSON body straight to the update,
 * so any church user could set `church_id`, `created_by`, the builder status
 * or the `mobile_*` columns that decide what a congregation reads in the app —
 * sharing a sermon without being an admin, or moving it to another church.
 * Two layers now stop that: the route reads only the fields the editor sends,
 * and `updateSermon` writes only columns it knows, whatever it is handed.
 */

/** Every column `updateSermon` may write on behalf of any caller. */
export const SERMON_UPDATABLE_COLUMNS = [
  "title",
  "topic",
  "scripture_refs",
  "audience",
  "duration_min",
  "style_notes",
  "status",
  "outline",
  "content",
  "model_used",
  "theme_id",
  "translation",
  "sermon_date",
] as const;

export type SermonUpdatableColumn = (typeof SERMON_UPDATABLE_COLUMNS)[number];

/** Drops every key that is not a known editable column. */
export function pickSermonUpdatableColumns(
  patch: Record<string, unknown>,
): Partial<Record<SermonUpdatableColumn, unknown>> {
  const picked: Partial<Record<SermonUpdatableColumn, unknown>> = {};
  for (const column of SERMON_UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(patch, column) && patch[column] !== undefined) {
      picked[column] = patch[column];
    }
  }
  return picked;
}

export type SermonEditorPatch = {
  title?: string;
  topic?: string;
  scripture_refs?: string[];
  audience?: string;
  duration_min?: number;
  style_notes?: string | null;
  status?: "published";
  /** Checked to be an object; its fields are the manuscript the editor owns. */
  content?: SermonContent | null;
  translation?: string | null;
  sermon_date?: string | null;
};

const MAX_TEXT = 500;
const MAX_REFS = 50;

/**
 * What the sermon editor may send to `PATCH /api/sermon/[id]`.
 *
 * Narrower than `SERMON_UPDATABLE_COLUMNS` on purpose: the outline and model
 * come from the generators, and the slide theme from the deck route that
 * validates it. Unknown keys are ignored rather than rejected, so an older
 * client keeps saving; a known key with the wrong shape is a 400.
 */
export function parseSermonEditorPatch(
  body: unknown,
): { ok: true; patch: SermonEditorPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object" };
  }
  const source = body as Record<string, unknown>;
  const patch: SermonEditorPatch = {};
  const has = (key: string) =>
    Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined;

  const text = (key: "title" | "topic" | "audience") => {
    if (!has(key)) return true;
    const value = source[key];
    if (typeof value !== "string" || value.length > MAX_TEXT) return false;
    patch[key] = value;
    return true;
  };
  if (!text("title")) return { ok: false, error: "Invalid title" };
  if (!text("topic")) return { ok: false, error: "Invalid topic" };
  if (!text("audience")) return { ok: false, error: "Invalid audience" };

  if (has("scripture_refs")) {
    const refs = source.scripture_refs;
    if (
      !Array.isArray(refs) ||
      refs.length > MAX_REFS ||
      refs.some((ref) => typeof ref !== "string" || ref.length > MAX_TEXT)
    ) {
      return { ok: false, error: "Invalid scripture references" };
    }
    patch.scripture_refs = refs as string[];
  }

  if (has("duration_min")) {
    const minutes = source.duration_min;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 0 || minutes > 600) {
      return { ok: false, error: "Invalid duration" };
    }
    patch.duration_min = minutes;
  }

  for (const key of ["style_notes", "translation"] as const) {
    if (!has(key)) continue;
    const value = source[key];
    if (value !== null && (typeof value !== "string" || value.length > 5000)) {
      return { ok: false, error: `Invalid ${key.replace("_", " ")}` };
    }
    patch[key] = value as string | null;
  }

  if (has("sermon_date")) {
    const value = source.sermon_date;
    if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      return { ok: false, error: "Invalid sermon date" };
    }
    patch.sermon_date = value as string | null;
  }

  // "Mark published" only. Turning a published sermon back into a draft is
  // not something the editor offers, and it is what makes a sermon deletable —
  // including one the church has shared in the app.
  if (has("status")) {
    if (source.status !== "published") {
      return { ok: false, error: "Invalid status" };
    }
    patch.status = source.status;
  }

  if (has("content")) {
    const content = source.content;
    if (content !== null && (typeof content !== "object" || Array.isArray(content))) {
      return { ok: false, error: "Invalid content" };
    }
    patch.content = content as SermonContent | null;
  }

  return { ok: true, patch };
}
