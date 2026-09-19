import { z } from "zod";

import { SCHEDULE_FREQUENCIES, type ScheduleInput } from "@/lib/groups/types";

/**
 * Meeting schedules: validation and the sentence people read.
 *
 * Generation of actual gatherings happens in SQL (`generate_group_events`),
 * where `AT TIME ZONE` resolves DST. This module only validates input and
 * describes a schedule in words — "Every other Thursday at 6:30 PM" — which
 * must read the same on the dashboard and in both apps (the apps receive the
 * sentence rather than re-deriving it).
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS: Record<number, string> = { 1: "First", 2: "Second", 3: "Third", 4: "Fourth", [-1]: "Last" };

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const scheduleInputSchema = z
  .object({
    frequency: z.enum(SCHEDULE_FREQUENCIES),
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    weekOfMonth: z.coerce.number().int().refine((v) => [1, 2, 3, 4, -1].includes(v)).nullable().default(null),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a start time."),
    durationMinutes: z.coerce.number().int().min(15, "At least 15 minutes.").max(720, "At most 12 hours."),
    timezone: z.string().min(1).max(64).refine(isValidTimezone, "Choose a real time zone."),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  })
  .refine((v) => (v.frequency === "monthly") === (v.weekOfMonth !== null), {
    message: "Choose which week of the month.",
    path: ["weekOfMonth"],
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: "The schedule must end after it starts.",
    path: ["endsOn"],
  });

export function formatClock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "AM" : "PM";
  return m === 0 ? `${hour12}:00 ${suffix}` : `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Every Tuesday at 7:00 PM", "Every other Thursday at 6:30 PM", "Last Friday of the month at 7:00 PM". */
export function describeSchedule(schedule: Pick<ScheduleInput, "frequency" | "dayOfWeek" | "weekOfMonth" | "startTime">): string {
  const day = WEEKDAYS[schedule.dayOfWeek] ?? "day";
  const time = formatClock(schedule.startTime);
  switch (schedule.frequency) {
    case "weekly":
      return `Every ${day} at ${time}`;
    case "biweekly":
      return `Every other ${day} at ${time}`;
    case "monthly": {
      const ordinal = ORDINALS[schedule.weekOfMonth ?? 1] ?? "First";
      return `${ordinal} ${day} of the month at ${time}`;
    }
  }
}

/** "Weekly", "Every other week", "Monthly" — the short form for a filter chip or card. */
export function describeFrequency(frequency: ScheduleInput["frequency"]): string {
  return frequency === "weekly" ? "Weekly" : frequency === "biweekly" ? "Every other week" : "Monthly";
}

export function weekdayName(dayOfWeek: number): string {
  return WEEKDAYS[dayOfWeek] ?? "";
}

/** Database rows to the input shape. `start_time` arrives as HH:MM:SS. */
export function scheduleFromRow(row: Record<string, unknown>): ScheduleInput & { id: string; isActive: boolean } {
  return {
    id: row.id as string,
    frequency: row.frequency as ScheduleInput["frequency"],
    dayOfWeek: Number(row.day_of_week),
    weekOfMonth: row.week_of_month === null || row.week_of_month === undefined ? null : Number(row.week_of_month),
    startTime: String(row.start_time).slice(0, 5),
    durationMinutes: Number(row.duration_minutes),
    timezone: row.timezone as string,
    startsOn: String(row.starts_on),
    endsOn: (row.ends_on as string | null) ?? null,
    isActive: row.is_active !== false,
  };
}
