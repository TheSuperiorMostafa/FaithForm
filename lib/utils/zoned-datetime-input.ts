import {
  fromZonedInputValue,
  toZonedInputValue,
} from "@/lib/announcements/facebook-schedule";

/** Convert a datetime-local wall time in a named zone to an exact UTC instant. */
export function zonedInputToIso(value: string, timeZone: string): string | null {
  const instant = fromZonedInputValue(value, timeZone);
  if (instant === null || toZonedInputValue(instant, timeZone) !== value) {
    // Reject incomplete dates and nonexistent spring-forward wall times.
    return null;
  }
  return new Date(instant).toISOString();
}

/** Show a saved instant on the named clock, independent of the viewer's clock. */
export function isoToZonedInput(value: string, timeZone: string): string | null {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? toZonedInputValue(instant, timeZone) : null;
}
