const DAY_MS = 86_400_000;

/** Midnight UTC on the day an instant falls, which is how all-day dates are stored. */
function utcMidnight(ms: number): number {
  return Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The days an all-day event covers, as `YYYY-MM-DD`.
 *
 * The end is exclusive, the way both Google and iCalendar write it: a one-day
 * event on the 12th ends on the 13th. It is never shorter than one day, and an
 * end that is missing or not after the start gets that one day.
 */
export function allDaySpan(
  startAt: string,
  endAt: string | null,
): { start: string; end: string } {
  const start = utcMidnight(Date.parse(startAt));
  const requested = endAt ? Date.parse(endAt) : Number.NaN;
  const end =
    Number.isFinite(requested) && requested > start
      ? Math.max(start + DAY_MS, utcMidnight(requested))
      : start + DAY_MS;

  return { start: isoDay(start), end: isoDay(end) };
}
