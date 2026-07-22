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

/** Monday–Sunday window containing `date`. */
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
