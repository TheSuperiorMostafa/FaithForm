import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { VisitorError } from "@/lib/faithform/errors";
import { notifyGatheringCancelled } from "@/lib/groups/notifications";
import { labelMemberships, rsvpCounts, toEventSummary, type EventSummary } from "@/lib/groups/read-models";
import type { RsvpResponse } from "@/lib/groups/types";

/**
 * Gatherings and their attendance, shared by leaders in the app and staff on
 * the dashboard. Authorization is the caller's; everything here is scoped by
 * `church_id` and `group_id` at every read and write.
 */

const EVENT_COLUMNS =
  "id, church_id, group_id, schedule_id, title, description, starts_at, ends_at, timezone, location_name, location_address, online_meeting_url, status, is_generated, is_modified, cancelled_at, version, created_at";

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const eventInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the gathering a name.").max(120),
    description: z.string().trim().max(4000).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    timezone: z.string().max(64).refine(isValidTimezone, "Choose a real time zone.").optional(),
    locationName: z.string().trim().max(200).nullable().optional(),
    locationAddress: z.string().trim().max(500).nullable().optional(),
    onlineMeetingUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((v) => v === "" || /^https:\/\//i.test(v), "Meeting links must start with https://")
      .nullable()
      .optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "A gathering must end after it starts.",
    path: ["endsAt"],
  })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= 24 * 3_600_000, {
    message: "A gathering can last at most a day.",
    path: ["endsAt"],
  });

export type EventInput = z.infer<typeof eventInputSchema>;

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function listGroupEvents(
  admin: SupabaseClient,
  input: {
    churchId: string;
    groupId: string;
    when: "upcoming" | "past";
    accountId: string | null;
    cursor?: { at: string; id: string } | null;
    limit?: number;
    now?: Date;
  },
): Promise<{ items: EventSummary[]; nextCursor: { at: string; id: string } | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const now = (input.now ?? new Date()).toISOString();
  // A cursor came back from a client. Both halves are re-validated and
  // re-serialized before they reach a filter string, so nothing a client
  // shapes can become a second condition.
  let cursor: { at: string; id: string } | null = null;
  if (input.cursor) {
    const at = Date.parse(input.cursor.at);
    if (Number.isNaN(at) || !/^[0-9a-f-]{36}$/i.test(input.cursor.id)) {
      throw new VisitorError("invalid_input", "Invalid cursor.");
    }
    cursor = { at: new Date(at).toISOString(), id: input.cursor.id.toLowerCase() };
  }
  let query = admin
    .from("group_events")
    .select(EVENT_COLUMNS)
    .eq("church_id", input.churchId)
    .eq("group_id", input.groupId)
    .limit(limit + 1);

  if (input.when === "upcoming") {
    query = query.gte("ends_at", now).order("starts_at", { ascending: true }).order("id", { ascending: true });
    if (cursor) {
      query = query.or(`starts_at.gt.${cursor.at},and(starts_at.eq.${cursor.at},id.gt.${cursor.id})`);
    }
  } else {
    query = query.lt("ends_at", now).order("starts_at", { ascending: false }).order("id", { ascending: false });
    if (cursor) {
      query = query.or(`starts_at.lt.${cursor.at},and(starts_at.eq.${cursor.at},id.lt.${cursor.id})`);
    }
  }

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load gatherings.");
  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, limit);
  const counts = await rsvpCounts(admin, page.map((row) => row.id as string), input.accountId);
  const items = page.map((row) => {
    const tally = counts.get(row.id as string);
    return toEventSummary(row, tally?.mine ?? null, tally?.going ?? 0);
  });
  const last = page[page.length - 1];
  return {
    items,
    nextCursor: rows.length > limit && last ? { at: new Date(last.starts_at as string).toISOString(), id: last.id as string } : null,
  };
}

export type GatheringDetail = {
  event: EventSummary;
  description: string | null;
  locationAddress: string | null;
  onlineMeetingUrl: string | null;
  rsvpCounts: { going: number; maybe: number; notGoing: number };
  attendance: {
    taken: boolean;
    present: number;
    absent: number;
    guests: number;
    firstTimeGuests: number;
  } | null;
  version: number;
  isGenerated: boolean;
};

export async function getGathering(
  admin: SupabaseClient,
  input: { churchId: string; groupId: string; eventId: string; accountId: string | null; includeAttendance: boolean },
): Promise<GatheringDetail> {
  const { data } = await admin
    .from("group_events")
    .select(EVENT_COLUMNS)
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .eq("group_id", input.groupId)
    .maybeSingle();
  if (!data) throw new VisitorError("group_not_found", "That gathering was not found.");
  const row = data as Record<string, unknown>;

  const [counts, record] = await Promise.all([
    rsvpCounts(admin, [input.eventId], input.accountId),
    input.includeAttendance
      ? admin
          .from("group_attendance_records")
          .select("present_count, absent_count, guest_count, first_time_guest_count")
          .eq("event_id", input.eventId)
          .eq("church_id", input.churchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tally = counts.get(input.eventId) ?? { going: 0, maybe: 0, notGoing: 0, mine: null };
  const attendance = record.data as Record<string, number> | null;

  return {
    event: toEventSummary(row, tally.mine, tally.going),
    description: (row.description as string | null) ?? null,
    locationAddress: (row.location_address as string | null) ?? null,
    onlineMeetingUrl: (row.online_meeting_url as string | null) ?? null,
    rsvpCounts: { going: tally.going, maybe: tally.maybe, notGoing: tally.notGoing },
    attendance: input.includeAttendance
      ? {
          taken: Boolean(attendance),
          present: attendance?.present_count ?? 0,
          absent: attendance?.absent_count ?? 0,
          guests: attendance?.guest_count ?? 0,
          firstTimeGuests: attendance?.first_time_guest_count ?? 0,
        }
      : null,
    version: Number(row.version ?? 1),
    isGenerated: Boolean(row.is_generated),
  };
}

export async function createGathering(
  admin: SupabaseClient,
  input: {
    churchId: string;
    groupId: string;
    churchTimezone: string;
    actor: { type: "staff" | "leader"; userId: string };
    values: unknown;
  },
): Promise<string> {
  const parsed = eventInputSchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", parsed.error.issues[0]?.message ?? "Check the gathering details.");
  }
  const v = parsed.data;
  const { data, error } = await admin
    .from("group_events")
    .insert({
      church_id: input.churchId,
      group_id: input.groupId,
      title: v.title,
      description: blankToNull(v.description),
      starts_at: v.startsAt,
      ends_at: v.endsAt,
      timezone: v.timezone ?? input.churchTimezone,
      location_name: blankToNull(v.locationName),
      location_address: blankToNull(v.locationAddress),
      online_meeting_url: blankToNull(v.onlineMeetingUrl),
      created_by: input.actor.userId,
      updated_by: input.actor.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new VisitorError("unavailable", "Could not save that gathering.");

  await admin.rpc("log_group_event", {
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_action: "event_created",
    p_actor_type: input.actor.type,
    p_actor_user_id: input.actor.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: { eventId: data.id },
  });
  return data.id as string;
}

export async function updateGathering(
  admin: SupabaseClient,
  input: {
    churchId: string;
    groupId: string;
    eventId: string;
    churchTimezone: string;
    actor: { type: "staff" | "leader"; userId: string };
    values: unknown;
  },
): Promise<void> {
  const parsed = eventInputSchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", parsed.error.issues[0]?.message ?? "Check the gathering details.");
  }
  const v = parsed.data;
  const { data: existing } = await admin
    .from("group_events")
    .select("id, status")
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .eq("group_id", input.groupId)
    .maybeSingle();
  if (!existing) throw new VisitorError("group_not_found", "That gathering was not found.");
  if (existing.status === "cancelled") throw new VisitorError("conflict", "A cancelled gathering can't be edited.");

  const timezone = v.timezone ?? input.churchTimezone;
  const { error } = await admin
    .from("group_events")
    .update({
      title: v.title,
      description: blankToNull(v.description),
      starts_at: v.startsAt,
      ends_at: v.endsAt,
      timezone,
      location_name: blankToNull(v.locationName),
      location_address: blankToNull(v.locationAddress),
      online_meeting_url: blankToNull(v.onlineMeetingUrl),
      // A hand-edited generated gathering is left alone by regeneration.
      is_modified: true,
      updated_by: input.actor.userId,
    })
    .eq("id", input.eventId)
    .eq("church_id", input.churchId);
  if (error) throw new VisitorError("unavailable", "Could not save that gathering.");

  // Keep the attendance occurrence in step while nobody has been counted yet;
  // once someone has, the occurrence is history and stays as it was.
  const { data: occurrence } = await admin
    .from("service_occurrences")
    .select("id")
    .eq("group_event_id", input.eventId)
    .eq("church_id", input.churchId)
    .maybeSingle();
  if (occurrence) {
    const { count } = await admin
      .from("attendance_facts")
      .select("id", { count: "exact", head: true })
      .eq("service_occurrence_id", occurrence.id as string);
    if (!count) {
      const startMs = Date.parse(v.startsAt);
      const endMs = Date.parse(v.endsAt);
      await admin
        .from("service_occurrences")
        .update({
          label: v.title.slice(0, 200),
          starts_at_utc: v.startsAt,
          ends_at_utc: v.endsAt,
          checkin_opens_at_utc: new Date(startMs - 86_400_000).toISOString(),
          checkin_closes_at_utc: new Date(endMs + 30 * 86_400_000).toISOString(),
          timezone,
          updated_at: new Date().toISOString(),
        })
        .eq("id", occurrence.id as string)
        .eq("church_id", input.churchId);
    }
  }

  await admin.rpc("log_group_event", {
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_action: "event_updated",
    p_actor_type: input.actor.type,
    p_actor_user_id: input.actor.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: { eventId: input.eventId },
  });
}

export async function cancelGathering(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string | null;
    groupId: string;
    groupName: string;
    eventId: string;
    reason: string | null;
    actor: { type: "staff" | "leader"; userId: string };
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("group_events")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: input.actor.userId,
      cancellation_reason: input.reason?.slice(0, 300) ?? null,
      updated_by: input.actor.userId,
    })
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .eq("group_id", input.groupId)
    .eq("status", "scheduled")
    .select("id, starts_at, timezone, version")
    .maybeSingle();
  if (error) throw new VisitorError("unavailable", "Could not cancel that gathering.");
  if (!data) return; // Already cancelled, or not this group's: nothing to do.

  // The occurrence refuses attendance from now on; anyone already counted
  // stays counted (0055: cancelling never un-attends).
  await admin
    .from("service_occurrences")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: input.actor.userId,
      cancellation_reason: "Gathering cancelled",
      updated_at: now,
    })
    .eq("group_event_id", input.eventId)
    .eq("church_id", input.churchId);

  await admin.rpc("log_group_event", {
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_action: "event_cancelled",
    p_actor_type: input.actor.type,
    p_actor_user_id: input.actor.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: { eventId: input.eventId },
  });

  if (input.churchSlug && Date.parse(data.starts_at as string) > Date.now()) {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: data.timezone as string,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(data.starts_at as string));
    await notifyGatheringCancelled(admin, {
      churchId: input.churchId,
      churchSlug: input.churchSlug,
      groupId: input.groupId,
      groupName: input.groupName,
      eventId: input.eventId,
      eventVersion: Number(data.version ?? 1),
      when: when.charAt(0).toUpperCase() + when.slice(1),
    });
  }
}

export async function setRsvp(
  admin: SupabaseClient,
  input: { churchId: string; groupId: string; eventId: string; accountId: string; response: RsvpResponse },
): Promise<void> {
  const { data: event } = await admin
    .from("group_events")
    .select("id, status, ends_at")
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .eq("group_id", input.groupId)
    .maybeSingle();
  if (!event) throw new VisitorError("group_not_found", "That gathering was not found.");
  if (event.status === "cancelled") throw new VisitorError("conflict", "That gathering was cancelled.");
  if (Date.parse(event.ends_at as string) < Date.now()) {
    throw new VisitorError("conflict", "That gathering has already happened.");
  }
  const { error } = await admin.from("group_event_rsvps").upsert(
    {
      event_id: input.eventId,
      account_id: input.accountId,
      church_id: input.churchId,
      group_id: input.groupId,
      response: input.response,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id,account_id" },
  );
  if (error) throw new VisitorError("unavailable", "Could not save your answer.");
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type AttendanceSheet = {
  eventId: string;
  title: string;
  startsAt: string;
  timezone: string;
  taken: boolean;
  entries: {
    membershipId: string;
    name: string;
    avatarUrl: string | null;
    groupRole: string;
    present: boolean;
    recordable: boolean;
    memberId: string | null;
  }[];
  presentCount: number;
  absentCount: number;
  guestCount: number;
  firstTimeGuestCount: number;
  notes: string | null;
  recordableUntil: string;
  canRecord: boolean;
  lockedReason: "too_early" | "too_late" | "cancelled" | null;
  /** Staff only: People counted who are not on the roster. */
  guests: { memberId: string; name: string }[];
};

export async function getAttendanceSheet(
  admin: SupabaseClient,
  input: { churchId: string; groupId: string; eventId: string; now?: Date },
): Promise<AttendanceSheet> {
  const now = input.now ?? new Date();
  const { data: event } = await admin
    .from("group_events")
    .select("id, title, starts_at, ends_at, timezone, status")
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .eq("group_id", input.groupId)
    .maybeSingle();
  if (!event) throw new VisitorError("group_not_found", "That gathering was not found.");

  const [{ data: memberships }, { data: occurrence }, { data: record }] = await Promise.all([
    admin
      .from("group_memberships")
      .select("id, member_id, account_id, group_role")
      .eq("group_id", input.groupId)
      .eq("church_id", input.churchId)
      .eq("status", "active")
      .limit(2000),
    admin
      .from("service_occurrences")
      .select("id, checkin_opens_at_utc, checkin_closes_at_utc, status")
      .eq("group_event_id", input.eventId)
      .eq("church_id", input.churchId)
      .maybeSingle(),
    admin
      .from("group_attendance_records")
      .select("present_count, absent_count, guest_count, first_time_guest_count, notes")
      .eq("event_id", input.eventId)
      .eq("church_id", input.churchId)
      .maybeSingle(),
  ]);

  const rows = (memberships ?? []) as { id: string; member_id: string | null; account_id: string | null; group_role: string }[];
  const labels = await labelMemberships(admin, rows);

  let presentMembers = new Set<string>();
  const guests: { memberId: string; name: string }[] = [];
  if (occurrence) {
    const { data: facts } = await admin
      .from("attendance_facts")
      .select("member_id, members!inner(first_name, last_name)")
      .eq("service_occurrence_id", occurrence.id as string)
      .eq("church_id", input.churchId)
      .eq("status", "active")
      .limit(2000);
    const factRows = (facts ?? []) as { member_id: string; members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] }[];
    presentMembers = new Set(factRows.map((f) => f.member_id));
    const roster = new Set(rows.map((r) => r.member_id).filter(Boolean));
    for (const fact of factRows) {
      if (roster.has(fact.member_id)) continue;
      const person = Array.isArray(fact.members) ? fact.members[0] : fact.members;
      guests.push({ memberId: fact.member_id, name: `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim() });
    }
  }

  const startMs = Date.parse(event.starts_at as string);
  const endMs = Date.parse(event.ends_at as string);
  const opens = occurrence ? Date.parse(occurrence.checkin_opens_at_utc as string) : startMs - 86_400_000;
  const closes = occurrence ? Date.parse(occurrence.checkin_closes_at_utc as string) : endMs + 30 * 86_400_000;
  const lockedReason =
    event.status === "cancelled" ? "cancelled" : now.getTime() < opens ? "too_early" : now.getTime() > closes ? "too_late" : null;

  const entries = rows
    .map((row) => {
      const label = labels.get(row.id);
      return {
        membershipId: row.id,
        name: label?.name ?? "Church member",
        avatarUrl: label?.avatarUrl ?? null,
        groupRole: row.group_role,
        present: row.member_id ? presentMembers.has(row.member_id) : false,
        recordable: Boolean(row.member_id),
        memberId: row.member_id,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const attendance = record as Record<string, unknown> | null;
  return {
    eventId: event.id as string,
    title: event.title as string,
    startsAt: new Date(startMs).toISOString(),
    timezone: event.timezone as string,
    taken: Boolean(attendance),
    entries,
    presentCount: attendance ? Number(attendance.present_count) : entries.filter((e) => e.present).length,
    absentCount: attendance ? Number(attendance.absent_count) : 0,
    guestCount: attendance ? Number(attendance.guest_count) : 0,
    firstTimeGuestCount: attendance ? Number(attendance.first_time_guest_count) : 0,
    notes: (attendance?.notes as string | null) ?? null,
    recordableUntil: new Date(closes).toISOString(),
    canRecord: lockedReason === null,
    lockedReason,
    guests,
  };
}

export const attendanceSubmissionSchema = z.object({
  presentMembershipIds: z.array(z.string().uuid()).max(1000),
  guestCount: z.number().int().min(0).max(1000),
  firstTimeGuestCount: z.number().int().min(0).max(1000),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** Staff only: People records counted as known guests. */
  guestMemberIds: z.array(z.string().uuid()).max(200).optional(),
}).refine((v) => v.firstTimeGuestCount <= v.guestCount, {
  message: "First-time guests can't outnumber guests.",
  path: ["firstTimeGuestCount"],
});

export async function submitAttendance(
  admin: SupabaseClient,
  input: {
    churchId: string;
    groupId: string;
    eventId: string;
    actor: { type: "staff" | "leader"; userId: string };
    idempotencyKey: string;
    values: unknown;
  },
): Promise<{ outcome: string; rejected: number }> {
  const parsed = attendanceSubmissionSchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", parsed.error.issues[0]?.message ?? "Check the attendance.");
  }
  const v = parsed.data;

  // Membership ids to People ids, through this group's own active roster only.
  const { data: roster } = await admin
    .from("group_memberships")
    .select("id, member_id")
    .eq("group_id", input.groupId)
    .eq("church_id", input.churchId)
    .eq("status", "active")
    .in("id", v.presentMembershipIds.length ? v.presentMembershipIds : ["00000000-0000-0000-0000-000000000000"]);
  const memberIds = ((roster ?? []) as { member_id: string | null }[])
    .map((row) => row.member_id)
    .filter((id): id is string => Boolean(id));

  const guestMemberIds = input.actor.type === "staff" ? v.guestMemberIds ?? [] : [];
  const { data, error } = await admin.rpc("record_group_attendance", {
    p_event_id: input.eventId,
    p_church_id: input.churchId,
    p_present_member_ids: [...memberIds, ...guestMemberIds],
    p_guest_count: v.guestCount,
    p_first_time_guest_count: v.firstTimeGuestCount,
    p_notes: v.notes ?? null,
    p_actor_user_id: input.actor.userId,
    p_actor_type: input.actor.type,
    p_batch_key: input.idempotencyKey,
    // A leader marks their own group. Staff may also count a known guest.
    p_roster_only: input.actor.type !== "staff",
  });
  if (error) throw new VisitorError("unavailable", "Could not save attendance right now.");
  const row = ((data ?? []) as { outcome: string; rejected_member_ids: string[] | null }[])[0];
  const outcome = row?.outcome ?? "not_found";
  if (outcome === "not_found") throw new VisitorError("group_not_found", "That gathering was not found.");
  if (outcome === "cancelled") throw new VisitorError("conflict", "That gathering was cancelled.");
  if (outcome === "too_early") throw new VisitorError("conflict", "Attendance opens the day before the gathering.");
  if (outcome === "too_late") throw new VisitorError("conflict", "Attendance closes 30 days after a gathering.");
  return { outcome, rejected: row?.rejected_member_ids?.length ?? 0 };
}
