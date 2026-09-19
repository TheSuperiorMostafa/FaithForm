import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getChurchAttendancePolicy } from "@/lib/attendance/v2/setup";
import { VisitorError } from "@/lib/faithform/errors";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  type EventAttendanceSettings,
  DEFAULT_EVENT_ATTENDANCE,
} from "@/lib/attendance/v2/event-attendance-types";

export {
  type EventAttendanceSettings,
  DEFAULT_EVENT_ATTENDANCE,
};

export const eventAttendanceSchema = z
  .object({
    enabled: z.boolean(),
    calendarEventId: z.string().trim().min(1).max(1024),
    calendarId: z.string().trim().min(1).max(1024),
    calendarSource: z.enum(["google", "apple"]),
    title: z.string().trim().min(1).max(200),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().nullable().optional(),
    allDay: z.boolean().optional().default(false),
    campusId: z.string().uuid().nullable().optional(),
    automaticEnabled: z.boolean().optional().default(false),
    codeEnabled: z.boolean().optional().default(false),
    kioskEnabled: z.boolean().optional().default(false),
    checkinOpensMinutesBefore: z.coerce.number().int().min(0).max(240).default(30),
    checkinClosesMinutesAfter: z.coerce.number().int().min(0).max(240).default(30),
  })
  .refine((v) => !v.enabled || !v.allDay, {
    message: "Choose exact start and end times before counting attendance.",
    path: ["startAt"],
  })
  .refine((v) => !v.enabled || Boolean(v.endAt), {
    message: "Choose an end time before counting attendance.",
    path: ["endAt"],
  })
  .refine((v) => !v.endAt || Date.parse(v.endAt) > Date.parse(v.startAt), {
    message: "The event must end after it starts.",
    path: ["endAt"],
  })
  .refine(
    (v) =>
      !v.enabled ||
      v.checkinOpensMinutesBefore + v.checkinClosesMinutesAfter > 0,
    { message: "Check-in must be open for some time.", path: ["checkinClosesMinutesAfter"] },
  );

function localDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function mapRow(row: Record<string, unknown>): EventAttendanceSettings {
  const sources = ((row.policy_snapshot as Record<string, unknown> | null)?.sources ?? {}) as Record<string, unknown>;
  const start = Date.parse(row.starts_at_utc as string);
  const opens = Date.parse(row.checkin_opens_at_utc as string);
  const closes = Date.parse(row.checkin_closes_at_utc as string);
  return {
    enabled: row.status !== "cancelled",
    occurrenceId: row.id as string,
    campusId: (row.campus_id as string | null) ?? null,
    automaticEnabled: Boolean(sources.geofence),
    codeEnabled: Boolean(sources.qr),
    kioskEnabled: Boolean(sources.kiosk),
    checkinOpensMinutesBefore: Math.round((start - opens) / 60_000),
    checkinClosesMinutesAfter: Math.round((closes - start) / 60_000),
    locked: opens <= Date.now(),
  };
}

const EVENT_COLUMNS =
  "id, calendar_event_id, campus_id, starts_at_utc, checkin_opens_at_utc, checkin_closes_at_utc, status, policy_snapshot";

export async function listEventAttendanceSettings(
  churchId: string,
  calendarEventIds: string[],
  client?: SupabaseClient,
): Promise<Record<string, EventAttendanceSettings>> {
  if (calendarEventIds.length === 0) return {};
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("service_occurrences")
    .select(EVENT_COLUMNS)
    .eq("church_id", churchId)
    .in("calendar_event_id", [...new Set(calendarEventIds)].slice(0, 500));
  if (error) throw new VisitorError("unavailable", "Could not load event attendance.");
  return Object.fromEntries(
    ((data ?? []) as Record<string, unknown>[]).map((row) => [
      row.calendar_event_id as string,
      mapRow(row),
    ]),
  );
}

export async function saveEventAttendance(input: {
  churchId: string;
  churchTimezone: string;
  actorUserId: string;
  values: unknown;
  client?: SupabaseClient;
}): Promise<EventAttendanceSettings> {
  const parsed = eventAttendanceSchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", parsed.error.issues[0]?.message ?? "Check the attendance settings.");
  }
  const value = parsed.data;
  const admin = input.client ?? createAdminClient();
  const identity = admin
    .from("service_occurrences")
    .select(EVENT_COLUMNS)
    .eq("church_id", input.churchId)
    .eq("calendar_source", value.calendarSource)
    .eq("calendar_id", value.calendarId)
    .eq("calendar_event_id", value.calendarEventId);
  const { data: existing, error: readError } = await identity.maybeSingle();
  if (readError) throw new VisitorError("unavailable", "Could not load event attendance.");

  if (!value.enabled) {
    if (!existing) return { ...DEFAULT_EVENT_ATTENDANCE };
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("service_occurrences")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancelled_by: input.actorUserId,
        cancellation_reason: "Attendance disabled for calendar event",
        updated_at: now,
      })
      .eq("id", (existing as Record<string, unknown>).id as string)
      .eq("church_id", input.churchId)
      .select(EVENT_COLUMNS)
      .single();
    if (error || !data) throw new VisitorError("unavailable", "Could not turn attendance off.");
    await admin.from("event_attendance_setup_events").insert({
      church_id: input.churchId,
      calendar_event_id: value.calendarEventId,
      actor_user_id: input.actorUserId,
      action: "disabled",
      previous: existing,
      next: data,
    });
    return mapRow(data as Record<string, unknown>);
  }

  const existingRow = existing as Record<string, unknown> | null;
  if (existingRow && Date.parse(existingRow.checkin_opens_at_utc as string) <= Date.now()) {
    throw new VisitorError("conflict", "Check-in has already opened, so these settings are locked.");
  }

  const policy = await getChurchAttendancePolicy(input.churchId, admin);
  if (value.automaticEnabled && !policy.geofenceEnabled) {
    throw new VisitorError("invalid_input", "Turn on automatic check-in in Attendance setup first.");
  }
  if (value.codeEnabled && !policy.qrEnabled) {
    throw new VisitorError("invalid_input", "Turn on code check-in in Attendance setup first.");
  }
  if (value.kioskEnabled && !policy.kioskEnabled) {
    throw new VisitorError("invalid_input", "Turn on kiosk check-in in Attendance setup first.");
  }

  let campus: Record<string, unknown> | null = null;
  if (value.campusId) {
    const { data } = await admin
      .from("church_campuses")
      .select("id, timezone, latitude, longitude, geofence_radius_m, is_active, is_public")
      .eq("church_id", input.churchId)
      .eq("id", value.campusId)
      .eq("is_active", true)
      .maybeSingle();
    campus = data as Record<string, unknown> | null;
    if (!campus) throw new VisitorError("invalid_input", "Choose an active campus from this church.");
  }
  if (value.automaticEnabled && (!campus || !campus.is_public || campus.latitude == null || campus.longitude == null)) {
    throw new VisitorError("invalid_input", "Automatic check-in needs a published campus with a mapped location.");
  }

  const timezone = (campus?.timezone as string | undefined) ?? input.churchTimezone;
  const startMs = Date.parse(value.startAt);
  const endAt = value.endAt!;
  const row = {
    church_id: input.churchId,
    campus_id: value.campusId ?? null,
    service_time_id: null,
    calendar_event_id: value.calendarEventId,
    calendar_id: value.calendarId,
    calendar_source: value.calendarSource,
    label: value.title,
    local_service_date: localDate(value.startAt, timezone),
    timezone,
    starts_at_utc: value.startAt,
    ends_at_utc: endAt,
    checkin_opens_at_utc: new Date(startMs - value.checkinOpensMinutesBefore * 60_000).toISOString(),
    checkin_closes_at_utc: new Date(startMs + value.checkinClosesMinutesAfter * 60_000).toISOString(),
    status: "scheduled",
    generation_source: "manual",
    policy_version: policy.policyVersion,
    policy_snapshot: {
      sources: { manual: true, admin: true, geofence: value.automaticEnabled, qr: value.codeEnabled, kiosk: value.kioskEnabled },
      maxLocationAccuracyM: policy.maxLocationAccuracyM,
      minDwellSeconds: policy.minDwellSeconds,
      requiresConfirmation: policy.requiresConfirmation,
    },
    campus_latitude: campus?.latitude ?? null,
    campus_longitude: campus?.longitude ?? null,
    geofence_radius_m: campus?.geofence_radius_m ?? null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
    created_by: existingRow ? undefined : input.actorUserId,
    updated_at: new Date().toISOString(),
  };
  const cleanRow = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
  const { data, error } = await admin
    .from("service_occurrences")
    .upsert(cleanRow, { onConflict: "church_id,calendar_source,calendar_id,calendar_event_id" })
    .select(EVENT_COLUMNS)
    .single();
  if (error || !data) throw new VisitorError("conflict", "Could not save attendance for this event.");
  await admin.from("event_attendance_setup_events").insert({
    church_id: input.churchId,
    calendar_event_id: value.calendarEventId,
    actor_user_id: input.actorUserId,
    action: existingRow ? "updated" : "enabled",
    previous: existingRow,
    next: data,
  });
  return mapRow(data as Record<string, unknown>);
}

/** Keep a future attendance occurrence aligned when its calendar event moves. */
export async function syncEventAttendanceDetails(input: {
  churchId: string;
  actorUserId: string;
  calendarEventId: string;
  calendarId: string;
  calendarSource: "google" | "apple";
  title: string;
  startAt: string;
  endAt: string | null;
  allDay?: boolean;
  client?: SupabaseClient;
}): Promise<void> {
  const admin = input.client ?? createAdminClient();
  let query = admin
    .from("service_occurrences")
    .select(`${EVENT_COLUMNS}, timezone`)
    .eq("church_id", input.churchId)
    .eq("calendar_event_id", input.calendarEventId);
  if (input.calendarSource) {
    query = query.eq("calendar_source", input.calendarSource);
  }
  const { data } = await query.maybeSingle();
  if (!data) return;
  const previous = data as Record<string, unknown>;
  if (previous.status === "cancelled") return;

  const timesChanged =
    input.startAt !== previous.starts_at_utc ||
    input.endAt !== previous.ends_at_utc;

  if (timesChanged && Date.parse(previous.checkin_opens_at_utc as string) <= Date.now()) {
    throw new VisitorError("conflict", "Attendance times were not changed because check-in has already opened.");
  }
  if (input.allDay || !input.endAt) {
    throw new VisitorError("invalid_input", "Attendance needs exact event start and end times.");
  }
  const oldStart = Date.parse(previous.starts_at_utc as string);
  const opensBefore = oldStart - Date.parse(previous.checkin_opens_at_utc as string);
  const closesAfter = Date.parse(previous.checkin_closes_at_utc as string) - oldStart;
  const nextStart = Date.parse(input.startAt);
  const next = {
    label: input.title,
    local_service_date: localDate(input.startAt, previous.timezone as string),
    starts_at_utc: input.startAt,
    ends_at_utc: input.endAt,
    checkin_opens_at_utc: new Date(nextStart - opensBefore).toISOString(),
    checkin_closes_at_utc: new Date(nextStart + closesAfter).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = await admin
    .from("service_occurrences")
    .update(next)
    .eq("id", previous.id as string)
    .eq("church_id", input.churchId)
    .select(EVENT_COLUMNS)
    .single();
  if (error || !updated) {
    throw new VisitorError("conflict", "The calendar changed, but its attendance time could not be updated.");
  }
  await admin.from("event_attendance_setup_events").insert({
    church_id: input.churchId,
    calendar_event_id: input.calendarEventId,
    actor_user_id: input.actorUserId,
    action: "updated",
    previous,
    next: updated,
  });
}
