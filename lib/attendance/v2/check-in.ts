import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import type {
  AttendanceOutcome,
  AttendanceReason,
  AttendanceResult,
} from "@/lib/attendance/v2/results";

/**
 * The one attendance command.
 *
 * Every source — manual, admin, geofence, QR, kiosk — reaches the database
 * through this function and no other. It is deliberately thin: the atomicity,
 * the window checks, the source-enabled check, the tenant check and the unique
 * counted fact all live in `record_attendance`, because splitting them across
 * application calls would put the attempt and the fact in different
 * transactions.
 *
 * What this layer adds is the part that cannot live in SQL: resolving *who*
 * the attempt is for, which differs by source and is the only place a caller
 * could otherwise smuggle in someone else's identity.
 */

export type CheckInSource = "manual" | "admin" | "geofence" | "qr" | "kiosk";
export type ActorType = "visitor" | "staff" | "kiosk" | "system";

export type CheckInInput = {
  occurrenceId: string;
  /** Resolved by the caller's own source-specific rules — never from a client. */
  memberId: string | null;
  source: CheckInSource;
  actorType: ActorType;
  idempotencyKey: string;
  accountId?: string | null;
  actorUserId?: string | null;
  observedAt?: string | null;
  distanceBand?: "inside" | "near" | "far" | "unknown" | null;
  accuracyBand?: "high" | "medium" | "low" | "unusable" | null;
  dwellSeconds?: number | null;
  /** Short-lived support evidence. Purged on the policy's schedule. */
  preciseEvidence?: Record<string, unknown> | null;
};

export async function recordAttendance(
  input: CheckInInput,
  client?: SupabaseClient,
): Promise<AttendanceResult> {
  const admin = client ?? createAdminClient();

  const { data, error } = await admin.rpc("record_attendance", {
    p_occurrence_id: input.occurrenceId,
    p_member_id: input.memberId,
    p_source: input.source,
    p_actor_type: input.actorType,
    p_idempotency_key: input.idempotencyKey,
    p_account_id: input.accountId ?? null,
    p_actor_user_id: input.actorUserId ?? null,
    p_observed_at: input.observedAt ?? null,
    p_distance_band: input.distanceBand ?? null,
    p_accuracy_band: input.accuracyBand ?? null,
    p_dwell_seconds: input.dwellSeconds ?? null,
    p_precise_evidence: input.preciseEvidence ?? null,
  });

  if (error) {
    // The driver message is not surfaced: it can carry a constraint name, a
    // column list, or a row.
    throw new VisitorError("unavailable", "Could not record attendance.");
  }

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) {
    return {
      outcome: "rejected",
      reason: "internal_error",
      factId: null,
      attemptId: null,
      occurrenceId: null,
    };
  }

  return {
    outcome: row.outcome as AttendanceOutcome,
    reason: row.reason as AttendanceReason,
    factId: (row.fact_id as string | null) ?? null,
    attemptId: (row.attempt_id as string | null) ?? null,
    occurrenceId: (row.occurrence_id as string | null) ?? null,
  };
}

/**
 * Resolves the People record a Faithful account may check in as.
 *
 * This is the gate the whole self-check-in story rests on. Email, phone,
 * device id, visitor relationship and coordinates establish nothing: only an
 * active Prompt 3 `visitor_people_links` row does, and it must be for this
 * church.
 *
 * Also refuses a blocked relationship, so someone a church has blocked cannot
 * keep counting attendance through a link that predates the block.
 */
export async function resolveSelfCheckInMember(
  accountId: string,
  churchId: string,
  client?: SupabaseClient,
): Promise<
  | { ok: true; memberId: string }
  | { ok: false; reason: "no_people_link" | "relationship_revoked" | "consent_revoked" }
> {
  const admin = client ?? createAdminClient();

  const { data: relationship } = await admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", accountId)
    .eq("church_id", churchId)
    .maybeSingle();

  if (!relationship || relationship.state === "blocked" || relationship.state === "left") {
    return { ok: false, reason: "relationship_revoked" };
  }

  const { data: link } = await admin
    .from("visitor_people_links")
    .select("member_id")
    .eq("account_id", accountId)
    .eq("church_id", churchId)
    .eq("is_active", true)
    .maybeSingle();

  if (!link) return { ok: false, reason: "no_people_link" };

  return { ok: true, memberId: link.member_id as string };
}

/**
 * Automatic attendance requires explicit, current consent.
 *
 * `unset` is not consent, and a revoked consent blocks new attempts — while
 * leaving every legitimate historical fact exactly where it is.
 */
export async function hasAutomaticAttendanceConsent(
  accountId: string,
  client?: SupabaseClient,
): Promise<boolean> {
  const admin = client ?? createAdminClient();
  const { data } = await admin
    .from("visitor_accounts")
    .select("auto_attendance_consent")
    .eq("id", accountId)
    .maybeSingle();

  return data?.auto_attendance_consent === "granted";
}

/** A server-minted key for a caller that has no logical intent of its own. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
