import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One answer to "who came" (migration 0083).
 *
 * A person can be recorded at church six ways, kept in three places: the
 * weekly sheet (`attendance_entries`), the app, a scanned code, the kiosk and
 * the Services roster (`attendance_facts`), and a room check-in
 * (`checkin_sessions`). These read them as one, counting each person once a
 * day however many ways they were recorded.
 *
 * Every reader returns `null` rather than throwing when the database has not
 * received 0083 yet, so a page can keep showing what the weekly sheet alone
 * says instead of failing.
 */

export type PresenceMethod =
  | "weekly"
  | "automatic"
  | "scanned"
  | "kiosk"
  | "marked"
  | "room";

const METHODS: readonly PresenceMethod[] = [
  "weekly",
  "automatic",
  "scanned",
  "kiosk",
  "marked",
  "room",
];

/** How staff are told someone was recorded — in words, never by colour alone. */
export const PRESENCE_METHOD_LABELS: Record<PresenceMethod, string> = {
  weekly: "Marked on the Sunday count",
  automatic: "Checked in on their phone",
  scanned: "Scanned the code on screen",
  kiosk: "Checked in at the kiosk",
  marked: "Marked by staff",
  room: "Checked in to a kids room",
};

export type DayPresence = {
  /** Everyone present that day, each counted once. */
  present: number;
  /** Marked absent on the sheet and not recorded any other way. */
  absent: number;
  /** Present some way other than the weekly sheet. */
  checkedIn: number;
  /** Present because the app noticed them arrive. */
  automatic: number;
  /** A weekly sheet was saved for the day. */
  hasSheet: boolean;
};

function isPresenceMethod(value: unknown): value is PresenceMethod {
  return typeof value === "string" && (METHODS as readonly string[]).includes(value);
}

function reportUnavailable(name: string, message: string) {
  console.warn(`${name}: unified attendance is unavailable (${message}); using the weekly sheet alone.`);
}

/** Per day, between two local dates (inclusive). */
export async function getPresenceByDate(
  supabase: SupabaseClient,
  churchId: string,
  from: string,
  to: string,
): Promise<Map<string, DayPresence> | null> {
  const { data, error } = await supabase.rpc("attendance_presence_by_date", {
    p_church_id: churchId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    reportUnavailable("getPresenceByDate", error.message);
    return null;
  }

  const result = new Map<string, DayPresence>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    result.set(row.service_date as string, {
      present: Number(row.present ?? 0),
      absent: Number(row.absent ?? 0),
      checkedIn: Number(row.checked_in ?? 0),
      automatic: Number(row.automatic ?? 0),
      hasSheet: Boolean(row.has_sheet),
    });
  }
  return result;
}

/** Who was present on one day, and every way each of them was recorded. */
export async function getPresenceOnDate(
  supabase: SupabaseClient,
  churchId: string,
  date: string,
): Promise<Map<string, PresenceMethod[]> | null> {
  const { data, error } = await supabase.rpc("attendance_presence", {
    p_church_id: churchId,
    p_from: date,
    p_to: date,
  });

  if (error) {
    reportUnavailable("getPresenceOnDate", error.message);
    return null;
  }

  const result = new Map<string, PresenceMethod[]>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const memberId = row.member_id as string | null;
    const method = row.method;
    if (!memberId || !isPresenceMethod(method)) continue;
    const methods = result.get(memberId) ?? [];
    if (!methods.includes(method)) methods.push(method);
    result.set(memberId, methods);
  }
  return result;
}

/** How many days each person was at church, by any method, and the last one. */
export async function getDaysPresentByMember(
  supabase: SupabaseClient,
  churchId: string,
): Promise<Map<string, { days: number; last: string | null }> | null> {
  const { data, error } = await supabase.rpc("attendance_presence_by_member", {
    p_church_id: churchId,
  });

  if (error) {
    reportUnavailable("getDaysPresentByMember", error.message);
    return null;
  }

  const result = new Map<string, { days: number; last: string | null }>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    result.set(row.member_id as string, {
      days: Number(row.days_present ?? 0),
      last: (row.last_present as string | null) ?? null,
    });
  }
  return result;
}

/**
 * The ways someone was recorded other than the weekly sheet — the evidence
 * that they came even if the sheet says otherwise, or has not been filled in.
 */
export function checkedInOtherwise(
  methods: readonly PresenceMethod[] | undefined,
): PresenceMethod[] {
  return (methods ?? []).filter((method) => method !== "weekly");
}

export function describePresence(methods: readonly PresenceMethod[]): string {
  return METHODS.filter((method) => methods.includes(method))
    .map((method) => PRESENCE_METHOD_LABELS[method])
    .join(" · ");
}

/** A local `YYYY-MM-DD` is a Sunday. Weekday arithmetic only, no timezone. */
export function isSundayIsoDate(date: string): boolean {
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 0;
}
