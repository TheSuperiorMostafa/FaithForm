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
