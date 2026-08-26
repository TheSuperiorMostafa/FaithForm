import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { isValidTimeZone } from "@/lib/faithful/schemas";

/**
 * Service occurrences.
 *
 * An occurrence is the thing attendance attaches to. It snapshots the schedule,
 * the campus position, the timezone and the policy, so editing any of them
 * later cannot change what already happened.
 */

export type ServiceOccurrence = {
  id: string;
  churchId: string;
  campusId: string | null;
  campusName: string | null;
  label: string;
  localServiceDate: string;
  timezone: string;
  startsAtUtc: string;
  endsAtUtc: string;
  checkinOpensAtUtc: string;
  checkinClosesAtUtc: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
  generationSource: "schedule" | "manual" | "legacy_backfill";
  policyVersion: number;
};

const OCCURRENCE_COLUMNS = `
  id, church_id, campus_id, label, local_service_date, timezone,
  starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
  status, generation_source, policy_version,
  church_campuses ( name )
`;

function mapOccurrence(row: Record<string, unknown>): ServiceOccurrence {
  const campus = row.church_campuses as { name: string } | { name: string }[] | null;
  const resolved = Array.isArray(campus) ? campus[0] : campus;
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    campusId: (row.campus_id as string | null) ?? null,
    campusName: resolved?.name ?? null,
    label: row.label as string,
    localServiceDate: row.local_service_date as string,
    timezone: row.timezone as string,
    startsAtUtc: row.starts_at_utc as string,
    endsAtUtc: row.ends_at_utc as string,
    checkinOpensAtUtc: row.checkin_opens_at_utc as string,
    checkinClosesAtUtc: row.checkin_closes_at_utc as string,
    status: row.status as ServiceOccurrence["status"],
    generationSource: row.generation_source as ServiceOccurrence["generationSource"],
    policyVersion: Number(row.policy_version ?? 1),
  };
}

/**
 * Generates a bounded rolling horizon.
 *
 * Idempotent by construction — the unique index on `(service_time_id,
 * starts_at_utc)` means a re-run or a concurrent generator produces no
 * duplicates, and the function reports how many it skipped for that reason.
 */
export async function generateOccurrences(
  churchId: string,
  fromDate: string,
  toDate: string,
  client?: SupabaseClient,
): Promise<{ created: number; skipped: number }> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin.rpc("generate_service_occurrences", {
    p_church_id: churchId,
    p_from_date: fromDate,
    p_to_date: toDate,
  });

  if (error) throw new VisitorError("unavailable", "Could not generate services.");

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  return {
    created: Number(row?.created ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}

/**
 * The occurrence a check-in would land on right now.
 *
 * Resolved server-side from the clock and the church, never supplied by a
 * client. When two services overlap — which a church can legitimately
 * configure — the one that started most recently wins, because that is the one
 * someone walking in is attending.
 */
export async function findOpenOccurrence(
  churchId: string,
  options?: { campusId?: string | null; now?: Date; client?: SupabaseClient },
): Promise<ServiceOccurrence | null> {
  const admin = options?.client ?? createAdminClient();
  const now = (options?.now ?? new Date()).toISOString();

  let query = admin
    .from("service_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("church_id", churchId)
    .in("status", ["scheduled", "active"])
    .lte("checkin_opens_at_utc", now)
    .gte("checkin_closes_at_utc", now)
    .order("starts_at_utc", { ascending: false })
    .limit(1);

  if (options?.campusId) query = query.eq("campus_id", options.campusId);

  const { data } = await query.maybeSingle();
  return data ? mapOccurrence(data as Record<string, unknown>) : null;
}

export const occurrencePageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursorStart: z.string().optional(),
  cursorId: z.string().uuid().optional(),
  campusId: z.string().uuid().optional(),
  status: z.enum(["scheduled", "active", "completed", "cancelled"]).optional(),
});

/** Bounded and keyset-paged on the same `(starts_at_utc desc, id desc)` the index serves. */
export async function listOccurrences(
  churchId: string,
  input?: unknown,
  client?: SupabaseClient,
): Promise<{ items: ServiceOccurrence[]; nextCursor: { start: string; id: string } | null }> {
  const parsed = occurrencePageSchema.safeParse(input ?? {});
  if (!parsed.success) throw new VisitorError("invalid_input", "Check your request.");

  const admin = client ?? createAdminClient();
  let query = admin
    .from("service_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("church_id", churchId)
    .order("starts_at_utc", { ascending: false })
    .order("id", { ascending: false })
    .limit(parsed.data.limit + 1);

  if (parsed.data.campusId) query = query.eq("campus_id", parsed.data.campusId);
  if (parsed.data.status) query = query.eq("status", parsed.data.status);
  if (parsed.data.cursorStart) {
    query = query.lt("starts_at_utc", parsed.data.cursorStart);
  }

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load services.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > parsed.data.limit;
  const page = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(mapOccurrence),
    nextCursor:
      hasMore && last
        ? { start: last.starts_at_utc as string, id: last.id as string }
        : null,
  };
}

export const manualOccurrenceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  campusId: z.string().uuid().optional().nullable(),
  localServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.coerce.number().int().min(15).max(600).default(90),
  timezone: z.string().min(1).max(64),
  checkinOpensMinutesBefore: z.coerce.number().int().min(0).max(240).default(30),
  checkinClosesMinutesAfter: z.coerce.number().int().min(0).max(240).default(30),
});

/**
 * A special service that no recurring schedule produced.
 *
 * Explicit and audited: a one-off gathering is a real thing, but it must not be
 * possible to conjure one silently, because an occurrence is what attendance
 * attaches to.
 */
export async function createManualOccurrence(input: {
  churchId: string;
  actorUserId: string;
  values: unknown;
  client?: SupabaseClient;
}): Promise<ServiceOccurrence> {
  const parsed = manualOccurrenceSchema.safeParse(input.values);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }
  if (!isValidTimeZone(parsed.data.timezone)) {
    throw new VisitorError("invalid_input", "Enter a valid IANA timezone.");
  }

  const admin = input.client ?? createAdminClient();

  if (parsed.data.campusId) {
    const { data: campus } = await admin
      .from("church_campuses")
      .select("id")
      .eq("id", parsed.data.campusId)
      .eq("church_id", input.churchId)
      .maybeSingle();
    if (!campus) {
      throw new VisitorError("invalid_input", "That campus is not in this church.");
    }
  }

  // The instant is resolved in Postgres from the local wall time and the zone,
  // for the same reason generation does it there: `AT TIME ZONE` knows about
  // DST and a JavaScript offset calculation does not.
  const { data, error } = await admin
    .rpc("create_manual_occurrence", {
      p_church_id: input.churchId,
      p_campus_id: parsed.data.campusId ?? null,
      p_label: parsed.data.label,
      p_local_date: parsed.data.localServiceDate,
      p_start_time: `${parsed.data.startTime}:00`,
      p_duration_minutes: parsed.data.durationMinutes,
      p_timezone: parsed.data.timezone,
      p_opens_before: parsed.data.checkinOpensMinutesBefore,
      p_closes_after: parsed.data.checkinClosesMinutesAfter,
      p_actor_user_id: input.actorUserId,
    })
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("conflict", "A service like that already exists.");
  }

  const { data: created } = await admin
    .from("service_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("id", (data as { id: string }).id)
    .maybeSingle();

  if (!created) throw new VisitorError("unavailable", "Could not create that service.");
  return mapOccurrence(created as Record<string, unknown>);
}

/**
 * Cancelling refuses new attendance but leaves every counted fact alone.
 *
 * People who were already counted attended; the service being cancelled later
 * does not un-attend them, and deleting their facts would destroy history to
 * tidy a calendar.
 */
export async function cancelOccurrence(input: {
  churchId: string;
  occurrenceId: string;
  actorUserId: string;
  reason?: string;
  client?: SupabaseClient;
}): Promise<void> {
  const admin = input.client ?? createAdminClient();

  const { error } = await admin
    .from("service_occurrences")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: input.actorUserId,
      cancellation_reason: input.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.occurrenceId)
    // Exact tenant predicate: an id from another church matches nothing.
    .eq("church_id", input.churchId);

  if (error) throw new VisitorError("unavailable", "Could not cancel that service.");

  await admin.from("attendance_corrections").insert({
    church_id: input.churchId,
    service_occurrence_id: input.occurrenceId,
    action: "occurrence_cancel",
    previous_status: "scheduled",
    new_status: "cancelled",
    actor_user_id: input.actorUserId,
    reason: input.reason ?? null,
  });
}
