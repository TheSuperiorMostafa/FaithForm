import { fromZonedInputValue } from "@/lib/announcements/facebook-schedule";

export type EventRepeat = "none" | "daily" | "weekly" | "monthly";

/** Only bounded, known rules leave the event form. Never accept raw RRULE text. */
export function eventRecurrenceRule(repeat: unknown, until: unknown, startAt: string, timeZone?: string | null): string | null {
  if (repeat === undefined || repeat === null || repeat === "none") return null;
  if (repeat !== "daily" && repeat !== "weekly" && repeat !== "monthly") {
    throw new Error("Choose a daily, weekly or monthly repeat.");
  }
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error("Choose the last date for this repeating event.");
  }
  const calendarDate = new Date(`${until}T23:59:59Z`);
  const localEnd = fromZonedInputValue(`${until}T23:59`, timeZone || "UTC");
  const end = new Date(localEnd === null ? NaN : localEnd + 59_000);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== until || !Number.isFinite(end.getTime()) || end.getTime() < Date.parse(startAt)) {
    throw new Error("The repeat end date must be on or after the event.");
  }
  if (end.getTime() - Date.parse(startAt) > 366 * 5 * 86_400_000) {
    throw new Error("Choose a repeat end date within five years.");
  }
  return `RRULE:FREQ=${repeat.toUpperCase()};UNTIL=${end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}
