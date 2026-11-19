import { z } from "zod";

/**
 * When approved clips post to Facebook.
 *
 * A church picks weekdays, a time (church time zone) and how many a day. Each
 * newly approved clip takes the next free slot after the ones already taken,
 * so approving five clips on Sunday fills Monday–Friday at noon.
 */
export const postScheduleSchema = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  per_day: z.number().int().min(1).max(3),
});

export type PostSchedule = z.infer<typeof postScheduleSchema>;

export const DEFAULT_POST_SCHEDULE: PostSchedule = { days: [1, 2, 3, 4, 5], time: "12:00", per_day: 1 };

/** Hours between a day's slots when posting more than once a day. */
const SPACING_HOURS = 4;

function zonedParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

/** UTC instant for a wall-clock time in a time zone (DST-safe). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(guess, timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const diff = target - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/**
 * The next `count` free slots strictly after `now` (plus a 10-minute margin so
 * a slot is never in the past by the time it is saved).
 */
export function nextPostSlots(
  schedule: PostSchedule,
  timeZone: string,
  taken: Date[],
  now: Date = new Date(),
  count = 1,
): Date[] {
  const [hh, mm] = schedule.time.split(":").map(Number);
  const takenMs = new Set(taken.map((date) => Math.round(date.getTime() / 60_000)));
  const earliest = now.getTime() + 10 * 60_000;
  const slots: Date[] = [];
  const today = zonedParts(now.getTime(), timeZone);
  for (let offset = 0; offset < 60 && slots.length < count; offset += 1) {
    // Walk calendar days in the church's zone.
    const probe = zonedTimeToUtc(today.year, today.month, today.day + offset, 12, 0, timeZone);
    const local = zonedParts(probe.getTime(), timeZone);
    if (!schedule.days.includes(local.weekday)) continue;
    for (let n = 0; n < schedule.per_day && slots.length < count; n += 1) {
      const hour = hh + n * SPACING_HOURS;
      if (hour > 23) break;
      const slot = zonedTimeToUtc(local.year, local.month, local.day, hour, mm, timeZone);
      if (slot.getTime() < earliest) continue;
      if (takenMs.has(Math.round(slot.getTime() / 60_000))) continue;
      slots.push(slot);
    }
  }
  return slots;
}

export function parseSchedule(value: unknown): PostSchedule {
  const parsed = postScheduleSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_POST_SCHEDULE;
}
