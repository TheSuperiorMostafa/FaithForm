import { fromZonedInputValue, resolveScheduleTimeZone } from "@/lib/announcements/facebook-schedule";
import { toYMD } from "@/lib/utils/dates";

export const EVENT_REPEAT_FREQUENCIES = [
  { value: "daily", label: "Daily", unit: "day", rule: "DAILY" },
  { value: "weekly", label: "Weekly", unit: "week", rule: "WEEKLY" },
  { value: "monthly", label: "Monthly", unit: "month", rule: "MONTHLY" },
  { value: "annually", label: "Annually", unit: "year", rule: "YEARLY" },
] as const;

export const EVENT_REPEAT_WEEKDAYS = [
  { code: "SU", label: "Sunday" },
  { code: "MO", label: "Monday" },
  { code: "TU", label: "Tuesday" },
  { code: "WE", label: "Wednesday" },
  { code: "TH", label: "Thursday" },
  { code: "FR", label: "Friday" },
  { code: "SA", label: "Saturday" },
] as const;

export type EventFrequency = (typeof EVENT_REPEAT_FREQUENCIES)[number]["value"];
export type EventWeekday = (typeof EVENT_REPEAT_WEEKDAYS)[number]["code"];
export type EventRepeat = "none" | EventFrequency | "custom";
export type CustomEventRepeat = {
  frequency: EventFrequency;
  interval: number | null;
  weekdays: EventWeekday[];
};

export const DEFAULT_CUSTOM_EVENT_REPEAT: CustomEventRepeat = {
  frequency: "weekly",
  interval: 1,
  weekdays: [],
};

const MAX_REPEAT_DAYS = 366 * 5;

export function eventRepeatStartDate(startAt: string, timeZone: string): string {
  return toYMD(new Date(startAt), timeZone);
}

export function eventRepeatStartWeekday(date: string): EventWeekday | undefined {
  return EVENT_REPEAT_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]?.code;
}

/** Only bounded, known rules leave the event form. Never accept raw RRULE text. */
export function buildEventRecurrence(
  repeat: unknown,
  until: unknown,
  startAt: string,
  timeZone?: string | null,
  customRepeat?: unknown,
) {
  if (repeat === undefined || repeat === null || repeat === "none") return null;
  const zone = resolveScheduleTimeZone(timeZone || "UTC");
  const custom = repeat === "custom" && customRepeat && typeof customRepeat === "object"
    ? customRepeat as Record<string, unknown>
    : null;
  const frequency = EVENT_REPEAT_FREQUENCIES.find(
    ({ value }) => value === (repeat === "custom" ? custom?.frequency : repeat),
  );
  if (!frequency) {
    throw new Error("Choose how often this event repeats.");
  }
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error("Choose the last date for this repeating event.");
  }
  const calendarDate = new Date(`${until}T23:59:59Z`);
  const localEnd = fromZonedInputValue(`${until}T23:59`, zone);
  const end = new Date(localEnd === null ? NaN : localEnd + 59_000);
  const startMs = Date.parse(startAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== until || !Number.isFinite(end.getTime()) || end.getTime() < startMs) {
    throw new Error("The repeat end date must be on or after the event.");
  }
  if (end.getTime() - startMs > MAX_REPEAT_DAYS * 86_400_000) {
    throw new Error("Choose a repeat end date within five years.");
  }
  const parts = [`FREQ=${frequency.rule}`];
  let repeatInterval: number | undefined;
  let repeatWeekdays: EventWeekday[] | undefined;
  if (custom) {
    const { interval, weekdays } = custom;
    if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > MAX_REPEAT_DAYS) {
      throw new Error(`Enter a whole number from 1 to ${MAX_REPEAT_DAYS} for how often the event repeats.`);
    }
    repeatInterval = interval;
    parts.push(`INTERVAL=${interval}`);
    if (frequency.value === "weekly") {
      if (!Array.isArray(weekdays) || weekdays.length > 7 ||
          weekdays.some((day) => !EVENT_REPEAT_WEEKDAYS.some(({ code }) => code === day))) {
        throw new Error("Choose valid days for this weekly repeat.");
      }
      const startDay = eventRepeatStartWeekday(eventRepeatStartDate(startAt, zone));
      repeatWeekdays = EVENT_REPEAT_WEEKDAYS.map(({ code }) => code)
        .filter((day) => day === startDay || weekdays.includes(day));
      parts.push(`BYDAY=${repeatWeekdays.join(",")}`, "WKST=SU");
    }
  }
  parts.push(`UNTIL=${end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  return {
    rule: `RRULE:${parts.join(";")}`,
    frequency: frequency.value,
    interval: repeatInterval,
    weekdays: repeatWeekdays,
    untilDate: until,
  };
}


export function eventRecurrenceRule(
  ...args: Parameters<typeof buildEventRecurrence>
): string | null {
  return buildEventRecurrence(...args)?.rule ?? null;
}
