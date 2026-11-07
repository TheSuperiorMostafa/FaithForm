import type { ServiceOccurrence } from "@/lib/attendance/v2/occurrences";

/** Recent services keep their attendance history without live-service setup controls. */
export function canConfigureService(
  occurrence: Pick<ServiceOccurrence, "status" | "checkinClosesAtUtc">,
  now = Date.now(),
): boolean {
  return (occurrence.status === "scheduled" || occurrence.status === "active") &&
    new Date(occurrence.checkinClosesAtUtc).getTime() > now;
}
