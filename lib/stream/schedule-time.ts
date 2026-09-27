import { zonedInputToIso } from "@/lib/utils/zoned-datetime-input";

/** Interpret a service's date and time on the church's clock, not the viewer's. */
export function churchServiceStartIso(value: string, timeZone: string): string | null {
  return zonedInputToIso(value, timeZone);
}
