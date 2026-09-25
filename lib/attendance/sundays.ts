import { getLast8Sundays, shiftYmd } from "@/lib/utils/dates";

/**
 * Which Sundays the Sunday count page lists.
 *
 * Eight by default, the most recent first. "Show earlier Sundays" adds eight at
 * a time, up to a year, so a pastor catching up after a holiday never has to
 * type a date. Anything older is one "Pick another date" away.
 */
export const SUNDAYS_PER_PAGE = 8;
export const MAX_SUNDAYS = 52;

/** `?weeks=` from the URL, as a whole number of pages, clamped to a year. */
export function parseWeeksParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= SUNDAYS_PER_PAGE) return SUNDAYS_PER_PAGE;
  const pages = Math.ceil(parsed / SUNDAYS_PER_PAGE);
  return Math.min(pages * SUNDAYS_PER_PAGE, MAX_SUNDAYS);
}

/** The most recent `count` Sundays in the church's timezone, newest first. */
export function recentSundays(now: Date, timezone: string, count: number): string[] {
  const [latest] = getLast8Sundays(now, timezone);
  if (!latest) return [];
  const total = Math.max(1, Math.min(count, MAX_SUNDAYS));
  return Array.from({ length: total }, (_, index) => shiftYmd(latest, -7 * index));
}
