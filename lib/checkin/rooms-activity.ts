/**
 * Rooms tab helpers: today's activity feed and in-dashboard capacity alerts.
 *
 * Built from `checkin_sessions` already loaded for the roster — no extra tables.
 */

import type { CheckinSessionRow, ChurchLocation } from "@/types/checkin";

/** Cap so a busy Sunday morning stays scannable. */
export const ACTIVITY_FEED_LIMIT = 100;

export type CheckinActivityKind = "checked_in" | "checked_out" | "released_without_code";

export type CheckinActivityEvent = {
  /** Stable key for React lists: session + kind. */
  id: string;
  sessionId: string;
  kind: CheckinActivityKind;
  at: string;
  childName: string;
  roomName: string;
  /** Override releases carry the volunteer's written reason. */
  reason: string | null;
};

export type RoomCapacityAlert = {
  kind: "full" | "over";
  locationId: string;
  locationName: string;
  count: number;
  capacity: number;
};

export type UnusualActivityAlert = {
  kind: "released_without_code";
  count: number;
};

export type RoomAlert = RoomCapacityAlert | UnusualActivityAlert;

function childName(session: CheckinSessionRow): string {
  return `${session.firstName} ${session.lastName}`.trim() || "A child";
}

/**
 * Today's check-ins and check-outs as a newest-first feed.
 *
 * Each session may contribute two events (in, then out). Override pickups are
 * a separate kind so the feed can highlight them without relying on SMS.
 */
export function buildActivityFeed(
  sessions: readonly CheckinSessionRow[],
  options: { limit?: number } = {},
): CheckinActivityEvent[] {
  const limit = options.limit ?? ACTIVITY_FEED_LIMIT;
  const events: CheckinActivityEvent[] = [];

  for (const session of sessions) {
    if (session.checkedInAt) {
      events.push({
        id: `${session.id}:in`,
        sessionId: session.id,
        kind: "checked_in",
        at: session.checkedInAt,
        childName: childName(session),
        roomName: session.locationName,
        reason: null,
      });
    }

    if (session.checkedOutAt) {
      const withoutCode = session.checkoutMethod === "override";
      events.push({
        id: `${session.id}:out`,
        sessionId: session.id,
        kind: withoutCode ? "released_without_code" : "checked_out",
        at: session.checkedOutAt,
        childName: childName(session),
        roomName: session.locationName,
        reason: withoutCode ? session.checkoutOverrideReason?.trim() || null : null,
      });
    }
  }

  events.sort((a, b) => {
    const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });

  return events.slice(0, limit);
}

/** Open sessions only — who is physically in rooms right now. */
export function openRosterSessions(
  sessions: readonly CheckinSessionRow[],
): CheckinSessionRow[] {
  return sessions.filter(
    (session) => session.status === "pre_checked_in" || session.status === "checked_in",
  );
}

/**
 * Rooms at or over capacity, plus a count of today's no-code releases.
 * Dashboard-only: no SMS.
 */
export function buildRoomAlerts(
  openSessions: readonly CheckinSessionRow[],
  locations: readonly ChurchLocation[],
  activity: readonly CheckinActivityEvent[] = [],
): RoomAlert[] {
  const alerts: RoomAlert[] = [];
  const checkedInByRoom = new Map<string, number>();

  for (const session of openSessions) {
    if (session.status !== "checked_in") continue;
    checkedInByRoom.set(
      session.locationId,
      (checkedInByRoom.get(session.locationId) ?? 0) + 1,
    );
  }

  for (const location of locations) {
    if (!location.isActive || location.capacity == null) continue;
    const count = checkedInByRoom.get(location.id) ?? 0;
    if (count < location.capacity) continue;
    alerts.push({
      kind: count > location.capacity ? "over" : "full",
      locationId: location.id,
      locationName: location.name,
      count,
      capacity: location.capacity,
    });
  }

  // Prefer a deterministic order: over-capacity first, then full, by name.
  alerts.sort((a, b) => {
    if (a.kind === "over" && b.kind === "full") return -1;
    if (a.kind === "full" && b.kind === "over") return 1;
    if (a.kind !== "released_without_code" && b.kind !== "released_without_code") {
      return a.locationName.localeCompare(b.locationName);
    }
    return 0;
  });

  const withoutCode = activity.filter((event) => event.kind === "released_without_code").length;
  if (withoutCode > 0) {
    alerts.push({ kind: "released_without_code", count: withoutCode });
  }

  return alerts;
}

/** Plain labels for feed rows and alert banners. */
export function activityActionLabel(kind: CheckinActivityKind): string {
  switch (kind) {
    case "checked_in":
      return "Checked in";
    case "checked_out":
      return "Picked up";
    case "released_without_code":
      return "Released without a code";
  }
}

export function capacityAlertMessage(alert: RoomCapacityAlert): string {
  if (alert.kind === "over") {
    return `${alert.locationName} is over capacity (${alert.count} / ${alert.capacity}).`;
  }
  return `${alert.locationName} is full (${alert.count} / ${alert.capacity}).`;
}

export function unusualActivityMessage(alert: UnusualActivityAlert): string {
  const children = alert.count === 1 ? "1 child was" : `${alert.count} children were`;
  return `${children} released without a pickup code today.`;
}

/** Clock time on the church's timezone, for today's feed. */
export function formatActivityTime(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const zone = timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return zone === "UTC" ? at.toISOString() : formatActivityTime(iso, "UTC");
  }
}
