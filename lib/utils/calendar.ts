/** Start of local calendar day (00:00:00.000). */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** End of local calendar day (23:59:59.999). */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Sunday on or before the given date. */
export function startOfWeekSunday(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/** Saturday on or after the given date. */
export function endOfWeekSaturday(date: Date): Date {
  const d = startOfDay(date);
  const daysUntilSaturday = 6 - d.getDay();
  d.setDate(d.getDate() + daysUntilSaturday);
  return endOfDay(d);
}

/** Monday on or before the given date (ISO week start). */
export function startOfWeekMonday(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Sunday on or after the given date (ISO week end). */
export function endOfWeekSunday(date: Date): Date {
  const d = startOfWeekMonday(date);
  d.setDate(d.getDate() + 6);
  return endOfDay(d);
}

export type WeekWindow = {
  weekStart: Date;
  weekEnd: Date;
  weekStartISO: string;
  weekEndISO: string;
  weekLabel: string;
  weekStartKey: string;
};

/**
 * Monday–Sunday window containing `date`, in the *runtime's* local timezone.
 *
 * Browser-only. On the server this resolves against UTC, which silently shifts
 * the week for every church outside it — use `getMondayWeekWindowInTimeZone`
 * with the church's timezone there.
 */
export function getMondayWeekWindow(date: Date = new Date()): WeekWindow {
  const weekStart = startOfWeekMonday(date);
  const weekEnd = endOfWeekSunday(date);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${weekEnd.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const weekStartKey = [
    weekStart.getFullYear(),
    String(weekStart.getMonth() + 1).padStart(2, "0"),
    String(weekStart.getDate()).padStart(2, "0"),
  ].join("-");

  return {
    weekStart,
    weekEnd,
    weekStartISO: weekStart.toISOString(),
    weekEndISO: weekEnd.toISOString(),
    weekLabel,
    weekStartKey,
  };
}

// ---------------------------------------------------------------------------
// TIMEZONE-AWARE WEEK MATH
// ---------------------------------------------------------------------------
// Server-local math is fine in the browser, but scheduled jobs run in UTC on
// Vercel. Anything that decides "is it Monday for this church yet?" — or that
// renders a date into an email — has to reason in the church's own timezone.

const DEFAULT_TIMEZONE = "America/New_York";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function safeTimeZone(timeZone?: string | null): string {
  const tz = timeZone?.trim();
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Wall-clock fields of `date` as seen in `timeZone`. */
function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number.parseInt(value, 10);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Intl emits hour 24 for midnight under hour12:false in some engines.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset (ms) between `timeZone` wall clock and UTC at the given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant matching a wall-clock time in `timeZone`. */
function zonedWallClockToUtc(
  parts: ZonedParts,
  timeZone: string,
): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // One refinement pass settles DST transitions, where the first guess can
  // land on the wrong side of the offset change.
  let ts = naive - zoneOffsetMs(new Date(naive), timeZone);
  ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** 0 = Sunday … 6 = Saturday, evaluated in `timeZone`. */
export function getZonedWeekday(date: Date, timeZone?: string | null): number {
  const tz = safeTimeZone(timeZone);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).format(date);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
  return index === -1 ? date.getUTCDay() : index;
}

function formatZonedDate(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
}

/**
 * Monday–Sunday window containing `date`, anchored to the church's timezone.
 *
 * `weekStartKey` is the local Monday as YYYY-MM-DD and doubles as the
 * once-per-week idempotency key for the Gmail draft job.
 */
export function getMondayWeekWindowInTimeZone(
  date: Date = new Date(),
  timeZone?: string | null,
): WeekWindow {
  const tz = safeTimeZone(timeZone);
  const parts = getZonedParts(date, tz);
  const weekday = getZonedWeekday(date, tz);
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;

  // Shift by whole days on the calendar date, then resolve back to instants —
  // this stays correct across DST because each boundary is solved separately.
  const mondayDate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - daysSinceMonday),
  );
  const sundayDate = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - daysSinceMonday + 6),
  );

  const weekStart = zonedWallClockToUtc(
    {
      year: mondayDate.getUTCFullYear(),
      month: mondayDate.getUTCMonth() + 1,
      day: mondayDate.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    tz,
  );

  const weekEnd = new Date(
    zonedWallClockToUtc(
      {
        year: sundayDate.getUTCFullYear(),
        month: sundayDate.getUTCMonth() + 1,
        day: sundayDate.getUTCDate(),
        hour: 23,
        minute: 59,
        second: 59,
      },
      tz,
    ).getTime() + 999,
  );

  const weekLabel = `${formatZonedDate(weekStart, tz, {
    month: "short",
    day: "numeric",
  })} – ${formatZonedDate(weekEnd, tz, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const weekStartKey = [
    mondayDate.getUTCFullYear(),
    String(mondayDate.getUTCMonth() + 1).padStart(2, "0"),
    String(mondayDate.getUTCDate()).padStart(2, "0"),
  ].join("-");

  return {
    weekStart,
    weekEnd,
    weekStartISO: weekStart.toISOString(),
    weekEndISO: weekEnd.toISOString(),
    weekLabel,
    weekStartKey,
  };
}

export type MonthWindow = {
  year: number;
  monthIndex: number;
  /** First visible day (Sunday before or on the 1st). */
  gridStart: Date;
  /** Last visible day (Saturday after or on the last day of month). */
  gridEnd: Date;
  startISO: string;
  endISO: string;
};

/**
 * Visible 6-week month grid window: from the Sunday before the 1st
 * through the Saturday after the last day of the month.
 */
export function getMonthWindow(year: number, monthIndex: number): MonthWindow {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const lastOfMonth = new Date(year, monthIndex + 1, 0);

  const gridStart = startOfWeekSunday(firstOfMonth);
  const gridEnd = endOfWeekSaturday(lastOfMonth);

  return {
    year,
    monthIndex,
    gridStart,
    gridEnd,
    startISO: gridStart.toISOString(),
    endISO: gridEnd.toISOString(),
  };
}

export function getMonthWindowForDate(date: Date): MonthWindow {
  return getMonthWindow(date.getFullYear(), date.getMonth());
}

export type CalendarDayCell = {
  date: Date;
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function getWeekdayLabels(): readonly string[] {
  return WEEKDAY_LABELS;
}

/**
 * Builds day cells for the month grid (typically 35 or 42 cells).
 */
export function buildMonthGridCells(
  year: number,
  monthIndex: number,
  today: Date = new Date(),
): CalendarDayCell[] {
  const { gridStart, gridEnd } = getMonthWindow(year, monthIndex);
  const cells: CalendarDayCell[] = [];
  const cursor = new Date(gridStart);
  const todayStart = startOfDay(today).getTime();

  while (cursor.getTime() <= gridEnd.getTime()) {
    const date = new Date(cursor);
    cells.push({
      date,
      dayOfMonth: date.getDate(),
      isCurrentMonth: date.getMonth() === monthIndex,
      isToday: startOfDay(date).getTime() === todayStart,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return cells;
}

export function formatMonthYear(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function addMonths(year: number, monthIndex: number, delta: number): {
  year: number;
  monthIndex: number;
} {
  const d = new Date(year, monthIndex + delta, 1);
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

type EventWithRange = {
  startAt: string;
  endAt: string | null;
};

/**
 * True if the event overlaps the given calendar day (local time).
 */
export function eventOverlapsDay(
  event: EventWithRange,
  day: Date,
): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const eventStart = new Date(event.startAt);
  const eventEnd = event.endAt ? new Date(event.endAt) : eventStart;

  return eventStart.getTime() <= dayEnd.getTime() && eventEnd.getTime() >= dayStart.getTime();
}

export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDayAgendaHeading(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
