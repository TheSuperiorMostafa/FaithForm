import { createAdminClient } from "@/lib/supabase/admin";
import { generateOccurrences } from "@/lib/attendance/v2/occurrences";

/**
 * The attendance background jobs.
 *
 * All three are bounded, idempotent, and safe to overlap. None of them logs a
 * coordinate, a People detail, a QR capability, or a kiosk credential — the
 * metrics they return are counts.
 */

/** How far ahead occurrences are materialized. */
const HORIZON_DAYS = 60;
/** Churches per invocation, so one run cannot exceed the function budget. */
const CHURCH_BATCH = 25;

export type GenerationResult = {
  churchesProcessed: number;
  occurrencesCreated: number;
  occurrencesSkipped: number;
};

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Materializes the rolling horizon.
 *
 * Idempotent at the database level — the unique index on `(service_time_id,
 * starts_at_utc)` means a re-run or a concurrent generator creates nothing
 * twice — so this needs no lock of its own, and two overlapping invocations
 * are merely wasteful rather than wrong.
 *
 * It generates from *yesterday* so a service that was added late still gets an
 * occurrence it can be checked into.
 */
export async function runOccurrenceGeneration(options?: {
  limit?: number;
  now?: Date;
}): Promise<GenerationResult> {
  const admin = createAdminClient();
  const now = options?.now ?? new Date();

  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(now);
  to.setUTCDate(to.getUTCDate() + HORIZON_DAYS);

  const { data: churches } = await admin
    .from("churches")
    .select("id")
    .limit(Math.min(options?.limit ?? CHURCH_BATCH, 100));

  const result: GenerationResult = {
    churchesProcessed: 0,
    occurrencesCreated: 0,
    occurrencesSkipped: 0,
  };

  for (const church of (churches ?? []) as { id: string }[]) {
    try {
      const generated = await generateOccurrences(church.id, ymd(from), ymd(to), admin);
      result.occurrencesCreated += generated.created;
      result.occurrencesSkipped += generated.skipped;
      result.churchesProcessed += 1;
    } catch {
      // One church's bad schedule must not stop the rest. The failure is
      // visible as a lower processed count rather than as a logged exception
      // that might carry a row.
    }
  }

  return result;
}

export type LifecycleResult = { activated: number; completed: number };

/**
 * Advances occurrence status with the clock.
 *
 * Separate from generation because it runs far more often and touches far fewer
 * rows. Both updates are set-based and bounded by the window index.
 */
export async function runOccurrenceLifecycle(now = new Date()): Promise<LifecycleResult> {
  const admin = createAdminClient();
  const iso = now.toISOString();

  const { data: activated } = await admin
    .from("service_occurrences")
    .update({ status: "active", updated_at: iso })
    .eq("status", "scheduled")
    .lte("starts_at_utc", iso)
    .gt("checkin_closes_at_utc", iso)
    .select("id");

  const { data: completed } = await admin
    .from("service_occurrences")
    .update({ status: "completed", updated_at: iso })
    .in("status", ["scheduled", "active"])
    .lte("checkin_closes_at_utc", iso)
    .select("id");

  return {
    activated: (activated ?? []).length,
    completed: (completed ?? []).length,
  };
}

export type CleanupResult = { evidencePurged: number; attemptsExpired: number };

/**
 * Purges short-lived evidence and expires stale attempts.
 *
 * The evidence purge is the one that matters for privacy: precise validation
 * data exists only to answer "why was I not counted", and it is emptied on the
 * policy's schedule rather than accumulating into a movement history.
 *
 * The row itself is kept — the attempt, its verdict and its coarse bands stay,
 * because that is the auditable part. Only the precise payload goes.
 */
export async function runAttendanceCleanup(options?: {
  now?: Date;
  limit?: number;
}): Promise<CleanupResult> {
  const admin = createAdminClient();
  const iso = (options?.now ?? new Date()).toISOString();
  const limit = Math.min(options?.limit ?? 500, 2000);

  const { data: expired } = await admin
    .from("attendance_attempts")
    .select("id")
    .not("precise_evidence", "is", null)
    .lte("evidence_expires_at", iso)
    .limit(limit);

  const ids = ((expired ?? []) as { id: string }[]).map((row) => row.id);
  let evidencePurged = 0;

  if (ids.length > 0) {
    const { error } = await admin
      .from("attendance_attempts")
      .update({ precise_evidence: null, evidence_expires_at: null })
      .in("id", ids);
    if (!error) evidencePurged = ids.length;
  }

  // An attempt that stalled awaiting dwell is expired once its window closed;
  // it must not sit pending forever waiting for a confirmation that will never
  // arrive.
  const { data: stale } = await admin
    .from("attendance_attempts")
    .select("id, service_occurrences!inner(checkin_closes_at_utc)")
    .eq("status", "pending_confirmation")
    .lt("service_occurrences.checkin_closes_at_utc", iso)
    .limit(limit);

  const staleIds = ((stale ?? []) as { id: string }[]).map((row) => row.id);
  let attemptsExpired = 0;

  if (staleIds.length > 0) {
    const { error } = await admin
      .from("attendance_attempts")
      .update({ status: "expired", result_reason: "too_late" })
      .in("id", staleIds);
    if (!error) attemptsExpired = staleIds.length;
  }

  return { evidencePurged, attemptsExpired };
}

export type KioskCleanupResult = { revoked: number };

/** Disables kiosk credentials past their expiry. */
export async function runKioskCleanup(now = new Date()): Promise<KioskCleanupResult> {
  const admin = createAdminClient();
  const iso = now.toISOString();

  const { data } = await admin
    .from("attendance_kiosk_credentials")
    .update({
      is_enabled: false,
      revoked_at: iso,
      // The credential itself is cleared: a disabled row with a live hash is
      // one bug away from being usable.
      credential_hash: `revoked:${iso}:${Math.random().toString(36).slice(2)}`,
    })
    .eq("is_enabled", true)
    .not("expires_at", "is", null)
    .lte("expires_at", iso)
    .select("id");

  return { revoked: (data ?? []).length };
}
