import { zonedInputToIso } from "@/lib/utils/zoned-datetime-input";

/** A service day is a calendar date, independent of upload and encoder clocks. */
export function isRecordingServiceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Match the canonical database projection while retaining its timestamp contract. */
export function recordingDateInstant(recordedAt: string, timeZone: string, serviceDate?: string | null): string {
  return isRecordingServiceDate(serviceDate)
    ? zonedInputToIso(`${serviceDate}T12:00`, timeZone) ?? recordedAt
    : recordedAt;
}

export function recordingDateValue(recordedAt: string, timeZone: string, serviceDate?: string | null): string {
  if (isRecordingServiceDate(serviceDate)) return serviceDate;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(recordedAt));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatRecordingDate(recordedAt: string, timeZone: string, serviceDate?: string | null, long = false): string {
  const date = recordingDateValue(recordedAt, timeZone, serviceDate);
  // The chosen day is never interpreted as midnight UTC in the viewer's zone.
  return new Intl.DateTimeFormat("en-US", {
    weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
