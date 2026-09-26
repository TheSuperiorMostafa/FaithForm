/**
 * Small, pure helpers for how a sermon reads on the dashboard. Browser-safe:
 * imported by client components and by tests.
 */

/** YYYY-MM-DD in the viewer's own calendar, not UTC. */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The Sunday a new sermon is most likely for: the coming Sunday, or today
 * when today is a Sunday (a pastor building slides on Sunday morning means
 * this morning).
 */
export function nextSunday(from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const daysUntil = (7 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntil);
  return toLocalDateString(date);
}

export type SermonStatusTone = "neutral" | "done";

export type SermonDisplayStatus = {
  /** Canonical vocabulary (audit §8.4): Draft · In the app. */
  label: "Draft" | "In the app";
  tone: SermonStatusTone;
  inApp: boolean;
};

/**
 * What a sermon's status badge says, from what members can actually see.
 *
 * Deliberately not the builder's `status` column: sharing marks a sermon
 * "published" there and removing it from the app leaves that alone (the
 * activity feed and hours-saved report count that first publish once). So a
 * sermon taken out of the app reads "Draft" again here, which is what the
 * pastor expects, without rewriting history the reports depend on.
 */
export function sermonDisplayStatus(input: {
  notesShared: boolean;
  slidesShared?: boolean;
}): SermonDisplayStatus {
  const inApp = input.notesShared || Boolean(input.slidesShared);
  return inApp
    ? { label: "In the app", tone: "done", inApp }
    : { label: "Draft", tone: "neutral", inApp };
}

/** "Sunday, September 28, 2026", or null for no date. */
export function formatSermonDate(
  date: string | null | undefined,
  style: "long" | "short" = "long",
): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(
    undefined,
    style === "long"
      ? { weekday: "long", year: "numeric", month: "long", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric", year: "numeric" },
  );
}

export type SermonDetailTab = "slides" | "lesson" | "manuscript";

/** Reads `?tab=` on the sermon page; anything else opens Slides. */
export function parseSermonDetailTab(value: unknown): SermonDetailTab {
  return value === "lesson" || value === "manuscript" ? value : "slides";
}
