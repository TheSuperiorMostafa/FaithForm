"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { createAdminClient } from "@/lib/supabase/admin";
import { featureActionError } from "@/lib/features/guard";
import { fail, toVisitorResult, type VisitorResult } from "@/lib/faithful/errors";
import {
  cancelOccurrence,
  createManualOccurrence,
  generateOccurrences,
  listOccurrences,
  type ServiceOccurrence,
} from "@/lib/attendance/v2/occurrences";
import {
  correctAttendance,
  getAttendanceReport,
  getMemberHistory,
  getRoster,
  markPresent,
  markPresentBulk,
  type BulkResult,
  type RosterEntry,
} from "@/lib/attendance/v2/roster";
import {
  endCheckinSession,
  getActiveSession,
  issueDisplayPairing,
  startCheckinSession,
} from "@/lib/attendance/v2/checkin-session";
import {
  endKioskSession,
  startKioskSession,
} from "@/lib/attendance/v2/kiosk-session";
import { checkinSigningStatus } from "@/lib/attendance/v2/signing";

/**
 * FaithForm's attendance administration.
 *
 * Every action resolves the church from the caller's own session, and every
 * write reaches the database through the one transactional command — the
 * dashboard is a caller of the attendance authority, not a second one.
 */

type StaffContext = { churchId: string; userId: string; isAdmin: boolean };

async function requireAttendanceStaff(): Promise<StaffContext> {
  const auth = await getChurchAuth();
  if (!auth) throw new Error("unauthenticated");

  const featureError = await featureActionError("attendance");
  if (featureError) throw new Error(featureError);

  return { churchId: auth.churchId, userId: auth.userId, isAdmin: auth.isAdmin };
}

/** Corrections are a higher bar than marking someone present. */
async function requireCorrectionRights(): Promise<StaffContext> {
  const context = await requireAttendanceStaff();
  if (!context.isAdmin) throw new Error("forbidden");
  return context;
}

function revalidateAttendance() {
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/services");
  revalidatePath("/dashboard/people");
}

export async function getOccurrences(input?: {
  campusId?: string;
  status?: "scheduled" | "active" | "completed" | "cancelled";
  cursorStart?: string;
}): Promise<ServiceOccurrence[]> {
  const auth = await getChurchAuth();
  if (!auth) return [];
  const page = await listOccurrences(auth.churchId, input ?? {}).catch(() => ({
    items: [],
    nextCursor: null,
  }));
  return page.items;
}

export async function getOccurrenceRoster(
  occurrenceId: string,
): Promise<RosterEntry[]> {
  const auth = await getChurchAuth();
  if (!auth) return [];
  return getRoster(auth.churchId, occurrenceId).catch(() => []);
}

/** One person, through the same command a geofence attempt uses. */
export async function markMemberPresent(input: {
  occurrenceId: string;
  memberId: string;
}): Promise<VisitorResult<{ outcome: string; reason: string }>> {
  try {
    const { churchId, userId } = await requireAttendanceStaff();
    const result = await markPresent({
      churchId,
      occurrenceId: input.occurrenceId,
      memberId: input.memberId,
      actorUserId: userId,
    });
    revalidateAttendance();
    return { ok: true, data: { outcome: result.outcome, reason: result.reason } };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Bulk marking.
 *
 * `batchKey` makes the whole submission idempotent: re-running the same batch
 * finds each person's own earlier attempt rather than creating a second one.
 * The caller gets a per-person result, because "42 marked, 3 already counted"
 * is what a person actually needs to see.
 */
export async function markRosterPresent(input: {
  occurrenceId: string;
  memberIds: string[];
  batchKey?: string;
}): Promise<VisitorResult<BulkResult[]>> {
  try {
    const { churchId, userId } = await requireAttendanceStaff();
    const results = await markPresentBulk({
      churchId,
      occurrenceId: input.occurrenceId,
      memberIds: input.memberIds,
      actorUserId: userId,
      batchKey: input.batchKey ?? randomUUID(),
    });
    revalidateAttendance();
    return { ok: true, data: results };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/** Reverse or restore. Audited, never destructive. */
export async function applyCorrection(input: {
  factId: string;
  action: "reverse" | "restore";
  reason?: string;
}): Promise<VisitorResult<{ newStatus: string | null }>> {
  try {
    const { churchId, userId } = await requireCorrectionRights();
    const result = await correctAttendance({
      churchId,
      factId: input.factId,
      action: input.action,
      actorUserId: userId,
      reason: input.reason,
    });
    revalidateAttendance();
    return { ok: true, data: { newStatus: result.newStatus } };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function addManualService(
  values: unknown,
): Promise<VisitorResult<ServiceOccurrence>> {
  try {
    const { churchId, userId } = await requireAttendanceStaff();
    const occurrence = await createManualOccurrence({
      churchId,
      actorUserId: userId,
      values,
    });
    revalidateAttendance();
    return { ok: true, data: occurrence };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/** Cancelling refuses new attendance and leaves counted facts untouched. */
export async function cancelService(input: {
  occurrenceId: string;
  reason?: string;
}): Promise<VisitorResult<null>> {
  try {
    const { churchId, userId } = await requireCorrectionRights();
    await cancelOccurrence({
      churchId,
      occurrenceId: input.occurrenceId,
      actorUserId: userId,
      reason: input.reason,
    });
    revalidateAttendance();
    return { ok: true, data: null };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/** Materializes the horizon on demand, for a church that just added a schedule. */
export async function refreshOccurrenceHorizon(): Promise<
  VisitorResult<{ created: number; skipped: number }>
> {
  try {
    const { churchId } = await requireAttendanceStaff();
    const from = new Date();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + 60);

    const result = await generateOccurrences(
      churchId,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    );
    revalidateAttendance();
    return { ok: true, data: result };
  } catch (error) {
    return toVisitorResult(error);
  }
}

// ---------------------------------------------------------------------------
// The rotating check-in display
// ---------------------------------------------------------------------------
//
// Prompt 6 had a `getServiceQrCode` here that minted a fifteen-minute token on
// demand. It was never called by anything, and it was the wrong shape: a
// capability nobody could stop, with a life long enough that a screenshot taken
// at the start of a service still worked at the end of it.
//
// What replaces it is a *session* a pastor starts and stops, whose codes rotate
// every thirty seconds, and which is displayed by a machine holding nothing but
// a read-only capability for one occurrence.

export type CheckinDisplayState = {
  /** Null when no display is running for this service. */
  sessionId: string | null;
  rotationSeconds: number;
  expiresAt: string | null;
  /** False when no signing key is configured, so the button explains itself. */
  signingConfigured: boolean;
};

export async function getCheckinDisplayState(
  occurrenceId: string,
): Promise<VisitorResult<CheckinDisplayState>> {
  try {
    const { churchId } = await requireAttendanceStaff();
    const session = await getActiveSession({ occurrenceId, churchId });
    const signing = checkinSigningStatus();

    return {
      ok: true,
      data: {
        sessionId: session?.sessionId ?? null,
        rotationSeconds: session?.rotationSeconds ?? 30,
        expiresAt: session?.expiresAt ?? null,
        signingConfigured: signing.configured,
      },
    };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Starts the display and returns the code to type into the projector.
 *
 * The pairing code is the only thing that crosses to the display machine, it is
 * shown once, and it is single-use. What the projector receives in exchange can
 * read this occurrence's current code and nothing else — no People, no other
 * service, no church settings, and no way to write anything.
 */
export async function startCheckinDisplay(input: {
  occurrenceId: string;
  rotationSeconds?: number;
}): Promise<
  VisitorResult<{
    sessionId: string;
    pairingCode: string;
    pairingExpiresAt: string;
    rotationSeconds: number;
    wasExisting: boolean;
  }>
> {
  try {
    const { churchId, userId } = await requireAttendanceStaff();

    const started = await startCheckinSession({
      occurrenceId: input.occurrenceId,
      churchId,
      actorUserId: userId,
      rotationSeconds: input.rotationSeconds,
    });

    if (!started.ok) {
      return fail(
        started.reason === "too_late" || started.reason === "occurrence_cancelled"
          ? "conflict"
          : "unavailable",
        started.reason === "too_late"
          ? "Check-in has closed for this service."
          : started.reason === "occurrence_cancelled"
            ? "This service was cancelled."
            : "Could not start the check-in display.",
      );
    }

    const pairing = await issueDisplayPairing({
      sessionId: started.session.sessionId,
      churchId,
      actorUserId: userId,
    });

    if (!pairing) {
      // Says *what* is wrong without naming the setting.
      //
      // A pastor is not the person who edits an environment variable, and a
      // message that names one is both unhelpful to them and one more place a
      // deployment detail travels to a browser. The variable is named in
      // `docs/faithful/P8_OPERATIONS_RUNBOOK.md`, where the person who can act
      // on it will look. `tests/security/checkin-privacy.test.ts` keeps it out
      // of anything that ships to a client.
      return fail(
        "unavailable",
        "Check-in codes aren't set up on this FaithForm installation yet.",
      );
    }

    revalidateAttendance();
    return {
      ok: true,
      data: {
        sessionId: started.session.sessionId,
        pairingCode: pairing.display,
        pairingExpiresAt: pairing.expiresAt,
        rotationSeconds: started.session.rotationSeconds,
        wasExisting: started.wasExisting,
      },
    };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Issues another pairing code for a display that is already running.
 *
 * Needed more often than it sounds: the projector rebooted, the browser was
 * closed, someone opened the page on the wrong machine. Re-pairing must not
 * require stopping and restarting the session, because restarting would rotate
 * the code out from under a room mid-scan.
 */
export async function refreshDisplayPairing(input: {
  occurrenceId: string;
}): Promise<VisitorResult<{ pairingCode: string; pairingExpiresAt: string }>> {
  try {
    const { churchId, userId } = await requireAttendanceStaff();

    const session = await getActiveSession({ occurrenceId: input.occurrenceId, churchId });
    if (!session) return fail("conflict", "No check-in display is running.");

    const pairing = await issueDisplayPairing({
      sessionId: session.sessionId,
      churchId,
      actorUserId: userId,
    });
    if (!pairing) return fail("unavailable", "Could not create a pairing code.");

    return {
      ok: true,
      data: { pairingCode: pairing.display, pairingExpiresAt: pairing.expiresAt },
    };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Stops the display.
 *
 * Immediate: the projector's next poll resolves the session, finds it ended,
 * and goes dark. **Nothing already counted changes.** A counted fact is
 * independent of the code that produced it, so stopping a display is not a
 * correction and does not touch attendance.
 */
export async function stopCheckinDisplay(input: {
  sessionId: string;
}): Promise<VisitorResult<{ stopped: boolean }>> {
  try {
    const { churchId, userId } = await requireAttendanceStaff();
    const stopped = await endCheckinSession({
      sessionId: input.sessionId,
      churchId,
      actorUserId: userId,
    });
    revalidateAttendance();
    return { ok: true, data: { stopped } };
  } catch (error) {
    return toVisitorResult(error);
  }
}

// ---------------------------------------------------------------------------
// Kiosks
// ---------------------------------------------------------------------------

export type KioskSummary = {
  id: string;
  label: string;
  status: string;
  pairedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string;
};

export async function listKiosks(
  occurrenceId: string,
): Promise<VisitorResult<KioskSummary[]>> {
  try {
    const { churchId } = await requireAttendanceStaff();
    const admin = createAdminClient();

    const { data } = await admin
      .from("attendance_kiosk_sessions")
      // No hashes. A staff member never needs to see one, and a serialisation
      // mistake cannot leak a column that was not selected.
      .select("id, label, status, paired_at, last_used_at, expires_at")
      .eq("church_id", churchId)
      .eq("service_occurrence_id", occurrenceId)
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .limit(20);

    return {
      ok: true,
      data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        label: row.label as string,
        status: row.status as string,
        pairedAt: (row.paired_at as string | null) ?? null,
        lastUsedAt: (row.last_used_at as string | null) ?? null,
        expiresAt: row.expires_at as string,
      })),
    };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Creates a kiosk for one service and returns the code to type into the tablet.
 *
 * Admin-only. A kiosk is a standing credential on a device in a public room —
 * a higher bar than marking one person present, and the same bar as a
 * correction.
 */
export async function startKiosk(input: {
  occurrenceId: string;
  label: string;
  idleLockSeconds?: number;
}): Promise<VisitorResult<{ kioskSessionId: string; pairingCode: string; expiresAt: string }>> {
  try {
    const { churchId, userId } = await requireCorrectionRights();

    const started = await startKioskSession({
      occurrenceId: input.occurrenceId,
      churchId,
      actorUserId: userId,
      label: input.label?.trim() || "Welcome desk",
      idleLockSeconds: input.idleLockSeconds,
    });

    if (!started) {
      return fail(
        "unavailable",
        "Could not start a check-in station. Check that check-in is still open for this service.",
      );
    }

    revalidateAttendance();
    return {
      ok: true,
      data: {
        kioskSessionId: started.kioskSessionId,
        pairingCode: started.pairingDisplay,
        expiresAt: started.expiresAt,
      },
    };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/** Revokes a kiosk. The credential stops resolving on the tablet's next call. */
export async function endKiosk(input: {
  kioskSessionId: string;
}): Promise<VisitorResult<{ ended: boolean }>> {
  try {
    const { churchId, userId } = await requireCorrectionRights();
    const ended = await endKioskSession({
      kioskSessionId: input.kioskSessionId,
      churchId,
      actorUserId: userId,
    });
    revalidateAttendance();
    return { ok: true, data: { ended } };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function getPersonAttendance(memberId: string) {
  const auth = await getChurchAuth();
  if (!auth) return [];
  return getMemberHistory(auth.churchId, memberId).catch(() => []);
}

/** Aggregated in SQL. */
export async function getReport(input: {
  from: string;
  to: string;
  campusId?: string;
  source?: string;
}) {
  const auth = await getChurchAuth();
  if (!auth) return [];
  return getAttendanceReport({
    churchId: auth.churchId,
    from: input.from,
    to: input.to,
    campusId: input.campusId ?? null,
    source: input.source ?? null,
  }).catch(() => []);
}
