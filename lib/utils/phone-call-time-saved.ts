import { AUTOMATION_CATALOG } from "@/lib/automation-catalog";

const PHONE_CALL_AUTOMATION = "Phone Call + Duration of Call";

/** Minutes credited toward hours saved for one answered call. */
export function phoneCallMinutesSaved(durationSeconds: number | null | undefined): number {
  // Length of the call (whole minutes, rounded up) plus the catalog's 5 minutes.
  const baseMinutes = AUTOMATION_CATALOG[PHONE_CALL_AUTOMATION].minutes;
  const durationMinutes =
    durationSeconds && durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;
  return durationMinutes + baseMinutes;
}

export function phoneCallTaskName(
  callerNumber: string | null | undefined,
  durationSeconds: number | null | undefined,
): string {
  const minutes = phoneCallMinutesSaved(durationSeconds);
  if (callerNumber?.trim()) {
    return `AI answered call from ${callerNumber.trim()} (${minutes} min saved)`;
  }
  return `AI phone call (${minutes} min saved)`;
}

export { PHONE_CALL_AUTOMATION };
