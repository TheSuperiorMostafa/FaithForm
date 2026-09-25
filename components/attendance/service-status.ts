/**
 * How a service is described on the Services page, in the canonical words
 * (audit §8.4): Upcoming · Check-in open · Done · Cancelled.
 *
 * Dependency-free on purpose: the Services board is a client component.
 */

export type ServiceStatusLabel = "Upcoming" | "Check-in open" | "Done" | "Cancelled";
export type ServiceStatusTone = "neutral" | "ready" | "done";

type StatusInput = {
  status: "scheduled" | "active" | "completed" | "cancelled";
  checkinOpensAtUtc: string;
  checkinClosesAtUtc: string;
};

export function serviceStatus(
  occurrence: StatusInput,
  now: number,
): { label: ServiceStatusLabel; tone: ServiceStatusTone } {
  if (occurrence.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  const opens = Date.parse(occurrence.checkinOpensAtUtc);
  const closes = Date.parse(occurrence.checkinClosesAtUtc);
  if (occurrence.status === "completed" || now > closes) return { label: "Done", tone: "done" };
  if (opens <= now && now <= closes) return { label: "Check-in open", tone: "ready" };
  return { label: "Upcoming", tone: "neutral" };
}
