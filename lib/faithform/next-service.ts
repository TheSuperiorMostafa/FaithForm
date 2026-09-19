/**
 * Which service comes next, in the church's own time zone.
 *
 * Service times are wall-clock times in the church's zone ("Sunday 10:30"
 * means ten-thirty where the church is), so "now" is converted into that zone
 * rather than the service into the viewer's. The phones compute the same thing
 * natively; this copy powers the dashboard's live preview.
 */

export type WeeklyService = { label: string; dayOfWeek: number; startTime: string };

export type NextService<T extends WeeklyService> = {
  service: T;
  /** 0 = today, 1 = tomorrow, … up to 7 for "same day next week". */
  daysAway: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function nowInZone(now: Date, timeZone: string): { weekday: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    // An unknown zone name: fall back to UTC rather than failing the page.
    return nowInZone(now, "UTC");
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function nextService<T extends WeeklyService>(
  services: readonly T[],
  timeZone: string,
  now: Date = new Date(),
): NextService<T> | null {
  const current = nowInZone(now, timeZone);
  let best: { service: T; daysAway: number; wait: number } | null = null;

  for (const service of services) {
    const start = minutesOf(service.startTime);
    if (start === null || service.dayOfWeek < 0 || service.dayOfWeek > 6) continue;

    let daysAway = (service.dayOfWeek - current.weekday + 7) % 7;
    // Already started today: its next occurrence is a week out.
    if (daysAway === 0 && start < current.minutes) daysAway = 7;

    const wait = daysAway * 24 * 60 + start - current.minutes;
    if (!best || wait < best.wait) best = { service, daysAway, wait };
  }

  return best ? { service: best.service, daysAway: best.daysAway } : null;
}

/** "10:30" → "10:30 AM" in the viewer's locale, with no time-zone conversion. */
export function formatServiceTime(time: string, locale?: string): string {
  const minutes = minutesOf(time);
  if (minutes === null) return time;
  const date = new Date(Date.UTC(2000, 0, 2, Math.floor(minutes / 60), minutes % 60));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
