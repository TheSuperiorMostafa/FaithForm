export type ChurchHealthStatus = "green" | "yellow" | "red" | "unknown";
export type ChurchHealth = { status: ChurchHealthStatus; reason: string; manual: boolean };
export type ChurchHealthSignals = {
  recent_days: number;
  previous_days: number;
  last_seen_at: string | null;
  open_tickets: number;
  health_override: "yellow" | "red" | null;
  health_note: string | null;
};

/** Staff visits, rather than background automations, measure engagement. */
export function churchHealth(signals: ChurchHealthSignals | null, createdAt: string, now = new Date()): ChurchHealth {
  if (!signals) return { status: "unknown", reason: "Health information is unavailable.", manual: false };
  if (signals.health_override === "red") return { status: signals.health_override, reason: signals.health_note || "Flagged by the FaithForm team.", manual: true };
  if (signals.open_tickets > 0) return { status: "red", reason: `${signals.open_tickets} unresolved support ${signals.open_tickets === 1 ? "ticket" : "tickets"}.`, manual: false };
  const lastActivity = new Date(signals.last_seen_at ?? createdAt).getTime();
  if (now.getTime() - lastActivity >= 14 * 86_400_000) return { status: "red", reason: "No recorded staff activity for at least 14 days.", manual: false };
  if (signals.health_override === "yellow") return { status: "yellow", reason: signals.health_note || "Flagged by the FaithForm team.", manual: true };
  if (signals.previous_days >= 2 && signals.recent_days < signals.previous_days / 2) return { status: "yellow", reason: "Active days fell by more than half compared with the previous week.", manual: false };
  if (signals.recent_days >= 2) return { status: "green", reason: `Staff used FaithForm on ${signals.recent_days} days in the past week.`, manual: false };
  return { status: "yellow", reason: signals.last_seen_at ? "Staff used FaithForm fewer than twice in the past week." : "No staff activity recorded yet.", manual: false };
}
