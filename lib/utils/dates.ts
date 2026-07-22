const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function toYMD(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

/** Shift a YYYY-MM-DD calendar date by a number of days (calendar math, UTC-safe). */
export function shiftYmd(ymd: string, deltaDays: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/**
 * Convert a local date + time in an IANA timezone to UTC milliseconds.
 * `date` is YYYY-MM-DD, `time` is HH:mm (24h).
 */
export function zonedDateTimeToUtcMs(
  date: string,
  time: string,
  timeZone: string,
): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(utcMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );

    const actualMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second ?? 0),
    );

    if (actualMs === targetMs) {
      return utcMs;
    }

    utcMs += targetMs - actualMs;
  }

  return utcMs;
}

export function getWeekdayName(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
}

export function isSundayDate(date: string, timezone: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return getWeekdayName(probe, timezone) === "Sunday";
}

export function getLast8Sundays(now: Date, timezone: string): string[] {
  const sundays: string[] = [];
  let cursor = new Date(now.getTime());

  for (let i = 0; i < 7; i++) {
    if (getWeekdayName(cursor, timezone) === "Sunday") {
      break;
    }
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  for (let i = 0; i < 8; i++) {
    sundays.push(toYMD(cursor, timezone));
    cursor = new Date(cursor.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return sundays;
}

export function formatServiceDate(
  date: string,
  options?: { isLatest?: boolean },
): string {
  if (options?.isLatest) {
    return "This past Sunday";
  }

  const [year, month, day] = date.split("-").map(Number);
  const labelDate = new Date(year, month - 1, day);

  return labelDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function isValidDateParam(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export { WEEKDAY_NAMES };
