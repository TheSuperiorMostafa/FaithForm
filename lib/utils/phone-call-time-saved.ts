import { AUTOMATION_CATALOG } from "@/lib/automation-catalog";

const PHONE_CALL_AUTOMATION = "Phone Call + Duration of Call";

/** Minutes credited toward hours saved for one answered call. */
export function phoneCallMinutesSaved(durationSeconds: number | null | undefined): number {
  const floorMinutes = AUTOMATION_CATALOG[PHONE_CALL_AUTOMATION].minutes;

  if (!durationSeconds || durationSeconds <= 0) {
    return floorMinutes;
  }

  const durationMinutes = Math.ceil(durationSeconds / 60);
  return Math.max(floorMinutes, durationMinutes);
}

export function phoneCallTaskName(
  callerNumber: string | null | undefined,
  durationSeconds: number | null | undefined,
): string {
  const minutes = phoneCallMinutesSaved(durationSeconds);
  if (callerNumber?.trim()) {
    return `AI phone call (${minutes} min saved)`;
  }
  return `AI phone call (${minutes} min saved)`;
}

export { PHONE_CALL_AUTOMATION };
