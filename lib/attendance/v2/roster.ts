import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { recordAttendance, newIdempotencyKey } from "@/lib/attendance/v2/check-in";

/**
 * The largest roster a single bulk call may cover.
 *
 * Enforced here and again in SQL. A batch beyond this would hold a transaction
 * open long enough to matter, and no real congregation is marked in one go at
 * that scale.
 */
export const MAX_BULK_MEMBERS = 1000;
import type { AttendanceResult } from "@/lib/attendance/v2/results";

/**
 * The occurrence roster, manual entry, and corrections.
 *
 * Bulk marking runs through the same transactional command as a single
 * check-in — one person at a time, each with its own idempotency key. That is
 * slower than a bulk insert and deliberately so: a bulk path that bypassed the
 * command would be a second attendance authority, and the per-person result is
 * exactly what the dashboard needs to show.
 */

export type RosterEntry = {
  memberId: string;
  firstName: string;
  lastName: string;
  factId: string | null;
  status: "active" | "reversed" | null;
  source: string | null;
  countedAt: string | null;
};

/**
 * The roster for one occurrence.
 *
 * Two bounded queries and a join in memory over *the church's own members* —
 * not over attendance history. A church with a thousand people is a thousand
 * rows; the alternative, a per-member attendance query, is the N+1 this avoids.
 */
export async function getRoster(
  churchId: string,
  occurrenceId: string,
  client?: SupabaseClient,
): Promise<RosterEntry[]> {
  const admin = client ?? createAdminClient();

  const [{ data: members }, { data: facts }] = await Promise.all([
    admin
      .from("members")
      .select("id, first_name, last_name")
      .eq("church_id", churchId)
      .eq("is_active", true)
      .order("first_name", { ascending: true })
      .limit(5000),
    admin
      .from("attendance_facts")
      .select("member_id, id, status, source, counted_at")
      .eq("service_occurrence_id", occurrenceId)
      .eq("church_id", churchId)
      .limit(5000),
  ]);

  const byMember = new Map(
    ((facts ?? []) as Record<string, unknown>[]).map((row) => [
      row.member_id as string,
      row,
    ]),
  );

  return ((members ?? []) as Record<string, unknown>[]).map((member) => {
    const fact = byMember.get(member.id as string);
    return {
      memberId: member.id as string,
      firstName: member.first_name as string,
      lastName: member.last_name as string,
      factId: (fact?.id as string | null) ?? null,
      status: (fact?.status as RosterEntry["status"]) ?? null,
      source: (fact?.source as string | null) ?? null,
      countedAt: (fact?.counted_at as string | null) ?? null,
    };
  });
}

export type BulkResult = {
  memberId: string;
  outcome: AttendanceResult["outcome"];
  reason: AttendanceResult["reason"];
};

/**
 * Marks several people present, in **one transaction and one round trip**.
 *
 * Delegates to `record_attendance_batch`, which loops over
 * `record_attendance` inside the database. That matters for three reasons:
 *
 *   - **No partial application.** An unexpected system failure rolls the whole
 *     batch back, so a closed browser or a dropped connection can never leave
 *     half a roster marked.
 *   - **No second insert path.** Every person still goes through the one
 *     attendance command, so the validation, the attempt audit and the unique
 *     counted fact are identical to a single check-in.
 *   - **One round trip.** A 400-person roster was 400 requests; it is now one.
 *
 * An *expected* per-person outcome is not a failure. `already_counted`,
 * `too_late` and `member_not_in_church` are answers — they come back for that
 * person and the rest of the batch still commits.
 */
export async function markPresentBulk(input: {
  churchId: string;
  occurrenceId: string;
  memberIds: string[];
  actorUserId: string;
  /** Stable across a retry of the same intent, so a repeat is idempotent. */
  batchKey: string;
  client?: SupabaseClient;
}): Promise<BulkResult[]> {
  if (input.memberIds.length === 0) return [];

  // Checked here as well as in SQL: a caller gets a clear message rather than a
  // constraint violation.
  if (input.memberIds.length > MAX_BULK_MEMBERS) {
    throw new VisitorError(
      "invalid_input",
      `Mark at most ${MAX_BULK_MEMBERS} people at once.`,
    );
  }

  const admin = input.client ?? createAdminClient();

  const { data, error } = await admin.rpc("record_attendance_batch", {
    p_occurrence_id: input.occurrenceId,
    p_member_ids: input.memberIds,
    p_source: "manual",
    p_actor_type: "staff",
    p_batch_key: input.batchKey,
    p_actor_user_id: input.actorUserId,
  });

  if (error) {
    // The transaction rolled back: nobody was marked. The driver message is not
    // surfaced — it can carry a constraint name or a row.
    throw new VisitorError("unavailable", "Could not mark that group present.");
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    memberId: row.member_id as string,
    outcome: row.outcome as AttendanceResult["outcome"],
    reason: row.reason as AttendanceResult["reason"],
  }));
}

/** A single manual add, through the same command. */
export async function markPresent(input: {
  churchId: string;
  occurrenceId: string;
  memberId: string;
  actorUserId: string;
  idempotencyKey?: string;
  client?: SupabaseClient;
}): Promise<AttendanceResult> {
  return recordAttendance(
    {
      occurrenceId: input.occurrenceId,
      memberId: input.memberId,
      source: "manual",
      actorType: "staff",
      idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
      actorUserId: input.actorUserId,
    },
    input.client,
  );
}

/**
 * Reverse or restore. Both append to the correction audit; neither deletes.
 *
 * The church predicate is applied inside the SQL function too, so a fact id
 * from another tenant resolves to nothing at both layers.
 */
export async function correctAttendance(input: {
  churchId: string;
  factId: string;
  action: "reverse" | "restore";
  actorUserId: string;
  reason?: string;
  client?: SupabaseClient;
}): Promise<{ ok: boolean; reason: string; newStatus: string | null }> {
  const admin = input.client ?? createAdminClient();

  const { data, error } = await admin.rpc("correct_attendance", {
    p_fact_id: input.factId,
    p_church_id: input.churchId,
    p_action: input.action,
    p_actor_user_id: input.actorUserId,
    p_reason: input.reason ?? null,
  });

  if (error) throw new VisitorError("unavailable", "Could not apply that correction.");

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  return {
    ok: Boolean(row?.ok),
    reason: (row?.reason as string) ?? "internal_error",
    newStatus: (row?.new_status as string | null) ?? null,
  };
}

export type MemberAttendanceEntry = {
  occurrenceId: string;
  label: string;
  localServiceDate: string;
  campusName: string | null;
  source: string;
  status: "active" | "reversed";
  countedAt: string;
};

/** One person's history. Bounded and ordered by the index that serves it. */
export async function getMemberHistory(
  churchId: string,
  memberId: string,
  limit = 50,
  client?: SupabaseClient,
): Promise<MemberAttendanceEntry[]> {
  const admin = client ?? createAdminClient();

  const { data } = await admin
    .from("attendance_facts")
    .select(`
      status, source, counted_at,
      service_occurrences ( id, label, local_service_date, church_campuses ( name ) )
    `)
    .eq("church_id", churchId)
    .eq("member_id", memberId)
    .order("counted_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const occurrence = row.service_occurrences as Record<string, unknown>;
    const campus = occurrence?.church_campuses as { name: string } | { name: string }[] | null;
    const resolvedCampus = Array.isArray(campus) ? campus[0] : campus;

    return {
      occurrenceId: (occurrence?.id as string) ?? "",
      label: (occurrence?.label as string) ?? "",
      localServiceDate: (occurrence?.local_service_date as string) ?? "",
      campusName: resolvedCampus?.name ?? null,
      source: row.source as string,
      status: row.status as "active" | "reversed",
      countedAt: row.counted_at as string,
    };
  });
}

export type AttendanceReportRow = {
  occurrenceId: string;
  label: string;
  localServiceDate: string;
  startsAtUtc: string;
  campusName: string | null;
  counted: number;
  reversed: number;
  bySource: Record<string, number>;
};

/** Aggregated in SQL. Nothing is counted in application memory. */
export async function getAttendanceReport(input: {
  churchId: string;
  from: string;
  to: string;
  campusId?: string | null;
  source?: string | null;
  client?: SupabaseClient;
}): Promise<AttendanceReportRow[]> {
  const admin = input.client ?? createAdminClient();

  const { data, error } = await admin.rpc("attendance_report", {
    p_church_id: input.churchId,
    p_from: input.from,
    p_to: input.to,
    p_campus_id: input.campusId ?? null,
    p_source: input.source ?? null,
  });

  if (error) throw new VisitorError("unavailable", "Could not build that report.");

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    occurrenceId: row.occurrence_id as string,
    label: row.label as string,
    localServiceDate: row.local_service_date as string,
    startsAtUtc: row.starts_at_utc as string,
    campusName: (row.campus_name as string | null) ?? null,
    counted: Number(row.counted ?? 0),
    reversed: Number(row.reversed ?? 0),
    bySource: (row.by_source as Record<string, number>) ?? {},
  }));
}
