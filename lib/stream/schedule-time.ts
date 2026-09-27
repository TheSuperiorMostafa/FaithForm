import {
  fromZonedInputValue,
  toZonedInputValue,
} from "@/lib/announcements/facebook-schedule";

/** Interpret a service's date and time on the church's clock, not the viewer's. */
export function churchServiceStartIso(value: string, timeZone: string): string | null {
  const instant = fromZonedInputValue(value, timeZone);
  if (instant === null || toZonedInputValue(instant, timeZone) !== value) {
    // A spring-forward gap, incomplete input, or invalid date has no matching
    // instant on the church's clock.
    return null;
  }
  return new Date(instant).toISOString();
}
