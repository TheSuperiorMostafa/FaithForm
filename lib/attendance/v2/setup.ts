import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import { bumpPublicProfileVersion } from "@/lib/faithform/discovery";
import { syncChurchOccurrences } from "@/lib/attendance/v2/occurrences";
import {
  CONSENT_COUNT_FLOOR,
  GEOFENCE_RADIUS_BOUNDS,
} from "@/lib/attendance/v2/setup-bounds";

export { CONSENT_COUNT_FLOOR, GEOFENCE_RADIUS_BOUNDS };

/**
 * A church's check-in setup: the church-wide attendance policy, where each
 * campus is, and when services happen.
 *
 * Every write here ends the same way: an append-only setup event recording who
 * changed what, and `syncChurchOccurrences`, so the services whose check-in has
 * not opened yet are judged by the setup the church has now rather than the one
 * it had when they were generated. Without that second step a church that
 * switched automatic check-in on would be refused for up to sixty days.
 *
 * Nothing here takes a church id from a browser. The dashboard actions resolve
 * it from the session and pass it in.
 */

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type AttendanceSetupPolicy = {
  geofenceEnabled: boolean;
  qrEnabled: boolean;
  kioskEnabled: boolean;
  checkinOpensMinutesBefore: number;
  checkinClosesMinutesAfter: number;
  requiresConfirmation: boolean;
  minDwellSeconds: number;
  maxLocationAccuracyM: number;
  policyVersion: number;
  updatedAt: string | null;
};

/** The column defaults from 0055, for a church that has never saved a policy. */
export const DEFAULT_SETUP_POLICY: AttendanceSetupPolicy = {
  geofenceEnabled: false,
  qrEnabled: false,
  kioskEnabled: false,
  checkinOpensMinutesBefore: 30,
  checkinClosesMinutesAfter: 30,
  requiresConfirmation: true,
  minDwellSeconds: 120,
  maxLocationAccuracyM: 100,
  policyVersion: 1,
  updatedAt: null,
};

/**
 * What a church admin may set.
 *
 * Tighter than the table where the table is looser than makes sense for a
 * person choosing: a dwell of a few seconds is not a dwell, and more than
 * thirty minutes would outlast most arrivals. The database constraints still
 * hold underneath (window not empty, confirmation needs a dwell).
 */
export const attendanceSetupPolicySchema = z
  .object({
    geofenceEnabled: z.boolean(),
    qrEnabled: z.boolean(),
    kioskEnabled: z.boolean(),
    checkinOpensMinutesBefore: z.coerce.number().int().min(0).max(240),
    checkinClosesMinutesAfter: z.coerce.number().int().min(0).max(240),
    requiresConfirmation: z.boolean(),
    minDwellSeconds: z.coerce.number().int().min(0).max(1800),
    maxLocationAccuracyM: z.coerce.number().int().min(25).max(500),
  })
  .refine(
    (value) => value.checkinOpensMinutesBefore + value.checkinClosesMinutesAfter > 0,
    {
      message: "Check-in has to be open for some time around the service.",
      path: ["checkinClosesMinutesAfter"],
    },
  )
  .refine((value) => !value.requiresConfirmation || value.minDwellSeconds >= 30, {
    message: "Choose how long someone should stay before they are checked in.",
    path: ["minDwellSeconds"],
  });

export type AttendanceSetupPolicyInput = z.input<typeof attendanceSetupPolicySchema>;

const POLICY_COLUMNS =
  "id, geofence_enabled, qr_enabled, kiosk_enabled, checkin_opens_minutes_before, checkin_closes_minutes_after, requires_confirmation, min_dwell_seconds, max_location_accuracy_m, policy_version, updated_at";

function mapPolicy(row: Record<string, unknown> | null): AttendanceSetupPolicy {
  if (!row) return { ...DEFAULT_SETUP_POLICY };
  return {
    geofenceEnabled: Boolean(row.geofence_enabled),
    qrEnabled: Boolean(row.qr_enabled),
    kioskEnabled: Boolean(row.kiosk_enabled),
    checkinOpensMinutesBefore: Number(row.checkin_opens_minutes_before ?? 30),
    checkinClosesMinutesAfter: Number(row.checkin_closes_minutes_after ?? 30),
    requiresConfirmation: Boolean(row.requires_confirmation ?? true),
    minDwellSeconds: Number(row.min_dwell_seconds ?? 120),
    maxLocationAccuracyM: Number(row.max_location_accuracy_m ?? 100),
    policyVersion: Number(row.policy_version ?? 1),
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

async function readPolicyRow(
  churchId: string,
  admin: SupabaseClient,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from("attendance_policies")
    .select(POLICY_COLUMNS)
    .eq("church_id", churchId)
    .is("campus_id", null)
    .is("service_time_id", null)
    .maybeSingle();
  if (error) throw new VisitorError("unavailable", "Could not load check-in settings.");
  return (data as Record<string, unknown> | null) ?? null;
}

export async function getChurchAttendancePolicy(
  churchId: string,
  client?: SupabaseClient,
): Promise<AttendanceSetupPolicy> {
  return mapPolicy(await readPolicyRow(churchId, client ?? createAdminClient()));
}

async function recordSetupEvent(
  admin: SupabaseClient,
  event: {
    churchId: string;
    actorUserId: string;
    action: "policy_updated" | "campus_location_updated" | "service_times_updated";
    targetId?: string | null;
    previous: unknown;
    next: unknown;
  },
): Promise<void> {
  // The audit row is written after the change, and a failure to write it does
  // not undo a setting the church has already been told was saved. It does
  // fail loudly enough to be seen in tests: the insert returns its error.
  await admin.from("attendance_setup_events").insert({
    church_id: event.churchId,
    actor_user_id: event.actorUserId,
    action: event.action,
    target_id: event.targetId ?? null,
    previous: event.previous ?? null,
    next: event.next ?? null,
  });
}

/**
 * Saves the church-wide policy and brings upcoming services in line with it.
 *
 * The church-level row only. Campus- and service-level overrides are honoured
 * by generation if they exist, but nothing in the dashboard creates them.
 */
export async function saveChurchAttendancePolicy(input: {
  churchId: string;
  actorUserId: string;
  values: unknown;
  client?: SupabaseClient;
}): Promise<{ policy: AttendanceSetupPolicy; servicesUpdated: number }> {
  const parsed = attendanceSetupPolicySchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError(
      "invalid_input",
      parsed.error.issues[0]?.message ?? "Check the values you entered.",
    );
  }

  const admin = input.client ?? createAdminClient();
  const previous = await readPolicyRow(input.churchId, admin);
  const v = parsed.data;

  const row = {
    geofence_enabled: v.geofenceEnabled,
    qr_enabled: v.qrEnabled,
    kiosk_enabled: v.kioskEnabled,
    checkin_opens_minutes_before: v.checkinOpensMinutesBefore,
    checkin_closes_minutes_after: v.checkinClosesMinutesAfter,
    requires_confirmation: v.requiresConfirmation,
    // With no wait required the command ignores dwell, and zero is what the
    // phones should be told: there is nothing to wait for.
    min_dwell_seconds: v.requiresConfirmation ? v.minDwellSeconds : 0,
    max_location_accuracy_m: v.maxLocationAccuracyM,
    updated_by: input.actorUserId,
  };

  const write = previous
    ? admin
        .from("attendance_policies")
        .update(row)
        .eq("id", previous.id as string)
        // Exact tenant predicate at the write, as everywhere else.
        .eq("church_id", input.churchId)
    : admin.from("attendance_policies").insert({ church_id: input.churchId, ...row });

  const { error } = await write;
  if (error) throw new VisitorError("unavailable", "Could not save check-in settings.");

  const saved = await readPolicyRow(input.churchId, admin);
  await recordSetupEvent(admin, {
    churchId: input.churchId,
    actorUserId: input.actorUserId,
    action: "policy_updated",
    targetId: (saved?.id as string | undefined) ?? null,
    previous: previous ? mapPolicy(previous) : null,
    next: mapPolicy(saved),
  });

  const synced = await syncChurchOccurrences(input.churchId, { client: admin });
  return {
    policy: mapPolicy(saved),
    servicesUpdated: synced.refreshed + synced.created,
  };
}

// ---------------------------------------------------------------------------
// Campus position
// ---------------------------------------------------------------------------


export const campusCheckinLocationSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce
      .number()
      .int()
      .min(GEOFENCE_RADIUS_BOUNDS.min, "Use a check-in radius of at least 50 metres.")
      .max(GEOFENCE_RADIUS_BOUNDS.max, "Use a check-in radius of at most 500 metres."),
  })
  // 0,0 is in the Gulf of Guinea. It is what an empty form parses to, never a
  // church.
  .refine((value) => !(value.latitude === 0 && value.longitude === 0), {
    message: "Set the church's location first.",
    path: ["latitude"],
  });

export type CampusCheckinLocationInput = z.input<typeof campusCheckinLocationSchema>;

export async function saveCampusCheckinLocation(input: {
  churchId: string;
  campusId: string;
  actorUserId: string;
  values: unknown;
  client?: SupabaseClient;
}): Promise<{ servicesUpdated: number }> {
  const parsed = campusCheckinLocationSchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError(
      "invalid_input",
      parsed.error.issues[0]?.message ?? "Check the location you entered.",
    );
  }

  const admin = input.client ?? createAdminClient();

  const { data: previous } = await admin
    .from("church_campuses")
    .select("id, latitude, longitude, geofence_radius_m")
    .eq("id", input.campusId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!previous) throw new VisitorError("invalid_input", "That campus is not in this church.");

  // Six decimal places is about 11 cm, and the column's own precision.
  const latitude = Math.round(parsed.data.latitude * 1e6) / 1e6;
  const longitude = Math.round(parsed.data.longitude * 1e6) / 1e6;

  const { error } = await admin
    .from("church_campuses")
    .update({
      latitude,
      longitude,
      geofence_radius_m: parsed.data.radiusMeters,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.campusId)
    .eq("church_id", input.churchId);

  if (error) throw new VisitorError("unavailable", "Could not save that location.");

  await recordSetupEvent(admin, {
    churchId: input.churchId,
    actorUserId: input.actorUserId,
    action: "campus_location_updated",
    targetId: input.campusId,
    previous: {
      latitude: previous.latitude === null ? null : Number(previous.latitude),
      longitude: previous.longitude === null ? null : Number(previous.longitude),
      radiusMeters: Number(previous.geofence_radius_m),
    },
    next: { latitude, longitude, radiusMeters: parsed.data.radiusMeters },
  });

  // A campus position is part of the public church profile the apps cache.
  await bumpPublicProfileVersion(input.churchId);

  const synced = await syncChurchOccurrences(input.churchId, { client: admin });
  return { servicesUpdated: synced.refreshed + synced.created };
}

// ---------------------------------------------------------------------------
// Service times
// ---------------------------------------------------------------------------

export type SetupServiceTime = {
  id: string;
  label: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string | null;
  campusId: string | null;
};

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 10:30.");

export const serviceScheduleSchema = z
  .array(
    z.object({
      id: z.string().uuid().optional().nullable(),
      label: z.string().trim().min(1, "Every service needs a name.").max(120),
      dayOfWeek: z.coerce.number().int().min(0).max(6),
      startTime: timeOfDay,
      endTime: z.union([timeOfDay, z.literal("")]).optional().nullable(),
      campusId: z.string().uuid().optional().nullable(),
    }),
  )
  .max(20, "A church can list up to 20 weekly services.");

export type ServiceScheduleInput = z.input<typeof serviceScheduleSchema>;

function hhmm(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}

export async function listServiceSchedule(
  churchId: string,
  client?: SupabaseClient,
): Promise<SetupServiceTime[]> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("church_service_times")
    .select("id, label, day_of_week, start_time, end_time, campus_id, sort_order")
    .eq("church_id", churchId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(50);

  if (error) throw new VisitorError("unavailable", "Could not load service times.");

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    dayOfWeek: Number(row.day_of_week),
    startTime: hhmm(row.start_time) ?? "00:00",
    endTime: hhmm(row.end_time),
    campusId: (row.campus_id as string | null) ?? null,
  }));
}

/**
 * Replaces the church's weekly services with the list given.
 *
 * Rows keep their id, so a service edited here is the same service everywhere
 * (the website, the phone assistant, and every attendance record already
 * attached to it). Columns this editor does not show (kind, notes) are left as
 * they are. A row missing from the list is deleted, which is what the website
 * editor has always done; its future services are retired by the sync that
 * follows, and its past ones keep their history.
 */
export async function saveServiceSchedule(input: {
  churchId: string;
  actorUserId: string;
  rows: unknown;
  client?: SupabaseClient;
}): Promise<{ serviceTimes: SetupServiceTime[]; servicesUpdated: number }> {
  const parsed = serviceScheduleSchema.safeParse(input.rows);
  if (!parsed.success) {
    throw new VisitorError(
      "invalid_input",
      parsed.error.issues[0]?.message ?? "Check the service times you entered.",
    );
  }

  const admin = input.client ?? createAdminClient();
  const previous = await listServiceSchedule(input.churchId, admin);
  const existingIds = new Set(previous.map((row) => row.id));

  const campusIds = Array.from(
    new Set(parsed.data.map((row) => row.campusId).filter((id): id is string => Boolean(id))),
  );
  if (campusIds.length > 0) {
    const { data: campuses } = await admin
      .from("church_campuses")
      .select("id")
      .eq("church_id", input.churchId)
      .in("id", campusIds);
    if ((campuses ?? []).length !== campusIds.length) {
      throw new VisitorError("invalid_input", "That campus is not in this church.");
    }
  }

  const kept = new Set<string>();
  const now = new Date().toISOString();

  for (const [index, row] of parsed.data.entries()) {
    const payload = {
      label: row.label,
      day_of_week: row.dayOfWeek,
      start_time: row.startTime,
      end_time: row.endTime ? row.endTime : null,
      campus_id: row.campusId ?? null,
      sort_order: index,
      updated_at: now,
    };

    if (row.id && existingIds.has(row.id)) {
      kept.add(row.id);
      const { error } = await admin
        .from("church_service_times")
        .update(payload)
        .eq("id", row.id)
        .eq("church_id", input.churchId);
      if (error) throw new VisitorError("unavailable", "Could not save service times.");
    } else {
      const { data, error } = await admin
        .from("church_service_times")
        .insert({ church_id: input.churchId, ...payload })
        .select("id")
        .single();
      if (error || !data) {
        throw new VisitorError("unavailable", "Could not save service times.");
      }
      kept.add(data.id as string);
    }
  }

  const removed = previous.filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (removed.length > 0) {
    const { error } = await admin
      .from("church_service_times")
      .delete()
      .in("id", removed)
      .eq("church_id", input.churchId);
    if (error) throw new VisitorError("unavailable", "Could not remove that service.");
  }

  const serviceTimes = await listServiceSchedule(input.churchId, admin);

  await recordSetupEvent(admin, {
    churchId: input.churchId,
    actorUserId: input.actorUserId,
    action: "service_times_updated",
    previous,
    next: serviceTimes,
  });

  await bumpPublicProfileVersion(input.churchId);

  const synced = await syncChurchOccurrences(input.churchId, { client: admin });
  return { serviceTimes, servicesUpdated: synced.refreshed + synced.created + synced.retired };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type SetupCampus = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  timezone: string;
  isPrimary: boolean;
  isPublic: boolean;
};

export type SetupUpcomingService = {
  id: string;
  label: string;
  campusName: string | null;
  timezone: string;
  startsAt: string;
  endsAt: string;
  checkinOpensAt: string;
  checkinClosesAt: string;
  automatic: boolean;
  positioned: boolean;
};

export type AttendanceSetupState = {
  policy: AttendanceSetupPolicy;
  campuses: SetupCampus[];
  serviceTimes: SetupServiceTime[];
  upcoming: SetupUpcomingService[];
  /** People records linked to a FaithForm account at this church. */
  linkedPeople: number;
  /**
   * How many of those have turned automatic check-in on in the app, or null
   * when fewer than `CONSENT_COUNT_FLOOR`. A church knows who is linked, so a
   * count of one or two would tell it who opted in; below the floor it is told
   * only that the number is small.
   */
  optedInPeople: number | null;
  lastChangedAt: string | null;
};


/** Below the floor a count is withheld, so it cannot single a person out. */
export function publishableOptInCount(count: number): number | null {
  return count >= CONSENT_COUNT_FLOOR ? count : null;
}

export async function getAttendanceSetupState(
  churchId: string,
  options?: { client?: SupabaseClient; now?: Date },
): Promise<AttendanceSetupState> {
  const admin = options?.client ?? createAdminClient();
  const now = options?.now ?? new Date();

  const [policy, serviceTimes, campusesResult, upcomingResult, linkedResult, optedInResult, lastEvent] =
    await Promise.all([
      getChurchAttendancePolicy(churchId, admin),
      listServiceSchedule(churchId, admin),
      admin
        .from("church_campuses")
        .select(
          "id, name, address_line1, city, state, latitude, longitude, geofence_radius_m, timezone, is_primary, is_public",
        )
        .eq("church_id", churchId)
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .order("sort_key", { ascending: true })
        .order("id", { ascending: true })
        .limit(50),
      admin
        .from("service_occurrences")
        .select(
          "id, label, timezone, starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc, policy_snapshot, campus_latitude, church_campuses ( name )",
        )
        .eq("church_id", churchId)
        .in("status", ["scheduled", "active"])
        .gte("checkin_closes_at_utc", now.toISOString())
        .order("starts_at_utc", { ascending: true })
        .limit(6),
      admin
        .from("visitor_people_links")
        .select("id", { count: "exact", head: true })
        .eq("church_id", churchId)
        .eq("is_active", true),
      admin
        .from("visitor_people_links")
        .select("id, visitor_accounts!inner(auto_attendance_consent)", {
          count: "exact",
          head: true,
        })
        .eq("church_id", churchId)
        .eq("is_active", true)
        .eq("visitor_accounts.auto_attendance_consent", "granted"),
      admin
        .from("attendance_setup_events")
        .select("created_at")
        .eq("church_id", churchId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const campuses: SetupCampus[] = ((campusesResult.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      id: row.id as string,
      name: row.name as string,
      address:
        [row.address_line1, row.city, row.state]
          .filter((part) => typeof part === "string" && part.trim())
          .join(", ") || null,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      radiusMeters: Number(row.geofence_radius_m ?? GEOFENCE_RADIUS_BOUNDS.default),
      timezone: row.timezone as string,
      isPrimary: Boolean(row.is_primary),
      isPublic: Boolean(row.is_public),
    }),
  );

  const upcoming: SetupUpcomingService[] = (
    (upcomingResult.data ?? []) as Record<string, unknown>[]
  ).map((row) => {
    const snapshot = (row.policy_snapshot as { sources?: Record<string, boolean> } | null) ?? {};
    const campus = row.church_campuses as { name: string } | { name: string }[] | null;
    const resolved = Array.isArray(campus) ? campus[0] : campus;
    return {
      id: row.id as string,
      label: row.label as string,
      campusName: resolved?.name ?? null,
      timezone: row.timezone as string,
      startsAt: row.starts_at_utc as string,
      endsAt: row.ends_at_utc as string,
      checkinOpensAt: row.checkin_opens_at_utc as string,
      checkinClosesAt: row.checkin_closes_at_utc as string,
      automatic: Boolean(snapshot.sources?.geofence),
      positioned: row.campus_latitude !== null && row.campus_latitude !== undefined,
    };
  });

  return {
    policy,
    campuses,
    serviceTimes,
    upcoming,
    linkedPeople: linkedResult.count ?? 0,
    optedInPeople: publishableOptInCount(optedInResult.count ?? 0),
    lastChangedAt: (lastEvent.data?.created_at as string | undefined) ?? null,
  };
}
