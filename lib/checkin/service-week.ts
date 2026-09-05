/**
 * Which Sunday it is, in the church's own timezone.
 *
 * Everything about children's check-in is keyed to a service week: the code a
 * parent reads out, the roster a volunteer looks at, the headcount a director
 * compares. Getting the week from the server's clock would put a church in
 * Hawaii on next week's code at 7pm on a Saturday, and a church in Maine on
 * last week's at 1am Sunday — so the date is always resolved through the
 * church's timezone, never through the process's.
 *
 * Weeks start on Sunday because that is what "this week's code" means to
 * everyone involved. A Wednesday programme belongs to the Sunday behind it.
 */

/** The calendar date in `timeZone` right now, as `YYYY-MM-DD`. */
export function localDateInTimeZone(
  timeZone: string,
  at: Date = new Date(),
): string {
  // `en-CA` is the shortest route to ISO ordering that Intl guarantees.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** 0 = Sunday … 6 = Saturday, for a date in `timeZone`. */
function weekdayInTimeZone(timeZone: string, at: Date): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(at);

  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
  return index === -1 ? 0 : index;
}

function shiftDate(isoDate: string, days: number): string {
  // Parsed as UTC midnight and shifted in whole days, so no local offset or
  // daylight-saving transition can move the result across a boundary.
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** The Sunday that starts the service week containing `at`, church-local. */
export function serviceWeekStart(
  timeZone: string,
  at: Date = new Date(),
): string {
  const today = localDateInTimeZone(timeZone, at);
  return shiftDate(today, -weekdayInTimeZone(timeZone, at));
}

/** The Sunday that starts the service week containing a `YYYY-MM-DD` date. */
export function serviceWeekStartForDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return shiftDate(isoDate, -parsed.getUTCDay());
}

/** The `count` most recent week starts, oldest first, ending at `weekStart`. */
export function recentServiceWeeks(weekStart: string, count: number): string[] {
  const weeks: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    weeks.push(shiftDate(weekStart, -7 * i));
  }
  return weeks;
}

export function formatServiceWeek(weekStart: string): string {
  const parsed = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return weekStart;
  return parsed.toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}
