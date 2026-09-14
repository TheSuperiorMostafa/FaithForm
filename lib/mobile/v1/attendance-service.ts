import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import { getVisitorAccount, requireActiveAccount } from "@/lib/faithform/account";
import {
  hasAutomaticAttendanceConsent,
  recordAttendance,
  resolveSelfCheckInMember,
} from "@/lib/attendance/v2/check-in";
import {
  campusIdFromRegionId,
  findOpenOccurrence,
} from "@/lib/attendance/v2/occurrences";
import { getMemberHistory } from "@/lib/attendance/v2/roster";
import {
  recordScan,
  resolveScannedToken,
  resolveTypedShortCode,
  type RedeemedCode,
} from "@/lib/attendance/v2/checkin-session";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { bandForAttempt } from "@/lib/attendance/v2/distance";
import { isAutomaticAttendanceLive } from "@/lib/attendance/v2/geofence-config";
import {
  ATTENDANCE_OUTCOMES,
  displayMessageFor,
  type AttendanceOutcome,
  type AttendanceReason,
} from "@/lib/attendance/v2/results";

/**
 * The mobile attendance surface.
 *
 * Everything a native client can do goes through here, and the shape of this
 * module is the security model: a client names an occurrence and reports an
 * observation. It never names a person, a church, a distance, or a result.
 */

async function resolveChurchId(slug: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) throw new VisitorError("church_not_found", "Church not found.");
  return data.id as string;
}

/**
 * The church in the path, for an active account that has a relationship with it.
 *
 * A church's service times are not secret, but which church an account can ask
 * about is still a relationship question: an account a church blocked, or one
 * that left, or one that never followed it, gets the same "not found" as a slug
 * that does not exist, so the answer reveals nothing about either.
 */
async function resolveRelatedChurch(
  userId: string,
  slug: string,
): Promise<{ churchId: string; account: Awaited<ReturnType<typeof requireActiveAccount>> }> {
  const account = await requireActiveAccount(userId);
  const churchId = await resolveChurchId(slug);

  const { data: relationship } = await createAdminClient()
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", account.id)
    .eq("church_id", churchId)
    .maybeSingle();

  if (!relationship || relationship.state === "blocked" || relationship.state === "left") {
    throw new VisitorError("church_not_found", "Church not found.");
  }

  return { churchId, account };
}

/**
 * The occurrence a check-in would land on right now.
 *
 * `regionId` is optional and additive: a phone that knows which OS region it
 * entered sends it, and at a church with several campuses it is handed the
 * service at *that* campus rather than whichever campus's service started most
 * recently. A client that omits it gets exactly the earlier behaviour.
 */
export async function getEligibleOccurrence(
  userId: string,
  churchSlug: string,
  options?: { regionId?: string | null },
) {
  const { churchId } = await resolveRelatedChurch(userId, churchSlug);
  const occurrence = await findOpenOccurrence(churchId, {
    campusId: campusIdFromRegionId(options?.regionId),
  });
  if (!occurrence) return null;

  return {
    occurrenceId: occurrence.id,
    label: occurrence.label,
    churchSlug,
    campusName: occurrence.campusName,
    localServiceDate: occurrence.localServiceDate,
    timezone: occurrence.timezone,
    startsAt: occurrence.startsAtUtc,
    endsAt: occurrence.endsAtUtc,
    checkinOpensAt: occurrence.checkinOpensAtUtc,
    checkinClosesAt: occurrence.checkinClosesAtUtc,
    status: occurrence.status,
  };
}

/**
 * What this account may do here.
 *
 * Deliberately omits the campus coordinates and radius. Telling a client where
 * the boundary is turns "am I inside" into a solvable puzzle; the server knows,
 * and the client only reports what it observed.
 */
export async function getAttendanceCapability(userId: string, churchSlug: string) {
  const { churchId, account } = await resolveRelatedChurch(userId, churchSlug);

  const occurrence = await findOpenOccurrence(churchId);
  if (!occurrence) return null;

  const admin = createAdminClient();
  const { data: occurrenceRow } = await admin
    .from("service_occurrences")
    .select("policy_snapshot")
    .eq("id", occurrence.id)
    .maybeSingle();

  const snapshot =
    (occurrenceRow?.policy_snapshot as Record<string, unknown> | null) ?? {};
  const sources = (snapshot.sources as Record<string, boolean> | undefined) ?? {};

  const link = await resolveSelfCheckInMember(account.id, churchId);
  const consent = await hasAutomaticAttendanceConsent(account.id);
  // The snapshot says how this service is judged; the live switch says whether
  // automatic check-in is still on at all. Both have to hold, exactly as they
  // do when the attempt is submitted.
  const automaticLive = Boolean(sources.geofence) && (await isAutomaticAttendanceLive(churchId));

  return {
    occurrenceId: occurrence.id,
    geofenceEnabled: automaticLive,
    qrEnabled: Boolean(sources.qr),
    manualEnabled: Boolean(sources.manual),
    requiresConfirmation: Boolean(snapshot.requiresConfirmation ?? true),
    minDwellSeconds: Number(snapshot.minDwellSeconds ?? 120),
    maxLocationAccuracyM: Number(snapshot.maxLocationAccuracyM ?? 100),
    hasVerifiedPeopleLink: link.ok,
    autoAttendanceConsent: account.autoAttendanceConsent,
    // Every precondition, evaluated once so the client does not have to.
    canAttemptAutomatically:
      automaticLive && link.ok && consent && occurrence.status !== "cancelled",
  };
}

export type AttemptInput = {
  /**
   * Required for a geofence attempt; **ignored for a QR one**.
   *
   * A scanner does not know which service it is looking at — that is what the
   * code is for. The occurrence comes out of the signed token or the short
   * code's own row, so a client cannot scan one service's code and have it
   * counted against another by naming the second.
   */
  occurrenceId?: string;
  source: "geofence" | "qr";
  phase: "detected" | "confirm";
  observedAt?: string;
  accuracyMeters?: number;
  dwellSeconds?: number;
  /** Inputs to the server's own distance computation; never stored. */
  latitude?: number;
  longitude?: number;
  mockLocationReported?: boolean;
  /** The client's logical attempt, for `detected`. */
  attemptId?: string;
  /** The server-issued detection, for `confirm`. */
  detectionId?: string;
  regionId?: string;
  configVersion?: number;
  qrToken?: string;
  /** The typed fallback. Mutually exclusive with `qrToken` in practice. */
  shortCode?: string;
  /**
   * A fresh random identity for one scan.
   *
   * Not authority — the `Idempotency-Key` header remains what makes a retry
   * idempotent. This is recorded so a support question about a specific scan is
   * answerable, and it exists to make the *client* contract explicit: a new tap
   * on "Scan" is a new attempt, never a replay of a refused one. Prompt 7 had
   * to learn this the hard way with geofence attempts, where a derived key made
   * one early refusal permanent for the whole service.
   */
  scanAttemptId?: string;
};

/**
 * How long a detection stays redeemable.
 *
 * Matches the client's own attempt lifetime, so the two expire together and a
 * device is never holding a detection the server has already forgotten.
 */
const DETECTION_LIFETIME_SECONDS = 2 * 60 * 60;

/**
 * Classifies an accuracy reading into a band.
 *
 * The value is never stored. A band answers "was this usable" without
 * accumulating a record of how well each phone sees the sky.
 */
function accuracyBand(
  meters: number | undefined,
  maxAllowed: number,
): "high" | "medium" | "low" | "unusable" {
  if (meters === undefined || meters < 0) return "unusable";
  if (meters > maxAllowed) return "unusable";
  if (meters <= 20) return "high";
  if (meters <= 50) return "medium";
  return "low";
}

/**
 * Submits an attendance attempt.
 *
 * Everything a client sends is treated as a claim about what its sensors saw,
 * never as a conclusion. The member is resolved from the verified People link,
 * the church from the occurrence, and the verdict from the policy snapshot.
 */
export async function submitAttempt(
  userId: string,
  idempotencyKey: string,
  input: AttemptInput,
) {
  // Active only. An account whose deletion was requested, or that was
  // deactivated, stops being checked in at that moment, the same way it stops
  // receiving notifications and loses its geofence configuration.
  const account = await requireActiveAccount(userId);

  const admin = createAdminClient();

  // Bounded before anything is read or written. A phone following the client
  // backoff (a bucket of 12 refilling at one a minute, two calls per attempt)
  // stays well inside this; a scripted client probing positions does not.
  if (input.source === "geofence" && (await throttleAutomaticAttempt(account.id))) {
    return reject("attempt_throttled", input.occurrenceId ?? null);
  }

  // -----------------------------------------------------------------------
  // A code decides which service this is.
  //
  // The occurrence is read out of the scanned token or the typed code's own
  // row, never from the request body. That removes a whole class of confusion
  // — scan the 9am code, claim the 11am service — without needing a check for
  // it, because the client never gets to name the target at all.
  // -----------------------------------------------------------------------
  let redeemedCode: RedeemedCode | null = null;
  let occurrenceId: string | null = input.occurrenceId ?? null;

  if (input.source === "qr") {
    const throttled = await throttleCodeAttempt(account.id, input);
    if (throttled) return reject("code_throttled", null);

    const redemption = input.shortCode
      ? await resolveTypedShortCode(input.shortCode, admin)
      : await resolveScannedToken(input.qrToken, admin);

    if (!redemption.ok) {
      return reject(reasonForRedemption(redemption.reason, Boolean(input.shortCode)), null);
    }

    redeemedCode = redemption.resolved;
    occurrenceId = redemption.resolved.occurrenceId;
  }

  if (!occurrenceId) return reject("occurrence_not_found", null);

  const loadOccurrence = async (id: string) =>
    (
      await admin
        .from("service_occurrences")
        .select(
          "id, church_id, campus_id, policy_snapshot, campus_latitude, campus_longitude, geofence_radius_m",
        )
        .eq("id", id)
        .maybeSingle()
    ).data;

  let occurrence = await loadOccurrence(occurrenceId);

  if (!occurrence) {
    return reject("occurrence_not_found", null);
  }

  const churchId = occurrence.church_id as string;

  // The People link is the gate. No link, no attendance — whatever the device
  // observed and whatever relationship exists.
  const link = await resolveSelfCheckInMember(account.id, churchId, admin);
  if (!link.ok) return reject(link.reason as AttendanceReason, occurrenceId);

  // Automatic attendance additionally requires current consent.
  if (input.source === "geofence") {
    if (!(await hasAutomaticAttendanceConsent(account.id, admin))) {
      return reject(
        account.autoAttendanceConsent === "revoked" ? "consent_revoked" : "consent_required",
        occurrenceId,
      );
    }

    // And the church must still have it switched on. The snapshot records how
    // this service is judged; it cannot keep a feature running that the church
    // or the platform has since turned off.
    if (!(await isAutomaticAttendanceLive(churchId, admin))) {
      return reject("source_disabled", occurrenceId);
    }

    // -----------------------------------------------------------------------
    // The service at the campus the phone is actually at.
    //
    // A client asks `/occurrence` which service is open, and before `regionId`
    // was accepted there that answer ignored campus: at a church with two
    // campuses holding services at the same hour, a phone at one was handed
    // the other's service, banded against the other building, and refused as
    // outside. So when the region the OS reported names a different campus of
    // this church, and that campus has a service open right now, the attempt
    // lands there. The region is the phone's claim and nothing more: the band
    // is still computed against that service's own snapshotted position, so
    // naming a campus you are not at gains nothing.
    // -----------------------------------------------------------------------
    const regionCampusId = campusIdFromRegionId(input.regionId);
    if (
      regionCampusId &&
      occurrence.campus_id &&
      (occurrence.campus_id as string) !== regionCampusId
    ) {
      const atRegion = await findOpenOccurrence(churchId, {
        campusId: regionCampusId,
        client: admin,
      });
      if (atRegion && atRegion.campusId === regionCampusId && atRegion.id !== occurrenceId) {
        const reloaded = await loadOccurrence(atRegion.id);
        if (reloaded && reloaded.church_id === churchId) {
          occurrence = reloaded;
          occurrenceId = atRegion.id;
        }
      }
    }
  }

  const snapshot = (occurrence.policy_snapshot as Record<string, unknown>) ?? {};

  // -----------------------------------------------------------------------
  // Record which code was used. **Audit only.**
  //
  // Prompt 6 consumed the nonce here and refused a second redemption, which
  // meant the first person to scan the projector took the code and everyone
  // else in the room was told it had already been used. A code on a screen is
  // meant to be used by the room.
  //
  // What stops one person being counted twice is the unique counted fact
  // inside `record_attendance` — one member, one occurrence — and it is
  // unaffected by how many codes that person scans. So this row is written and
  // nothing is gated on it.
  // -----------------------------------------------------------------------
  if (redeemedCode) {
    await recordScan({
      occurrenceId: redeemedCode.occurrenceId,
      accountId: account.id,
      churchId,
      nonce: redeemedCode.nonce,
      entryMethod: redeemedCode.entryMethod,
      client: admin,
    });
  }

  const maxAccuracy = Number(snapshot.maxLocationAccuracyM ?? 100);

  // ---------------------------------------------------------------------
  // Server-authoritative dwell.
  //
  // `dwellSeconds` used to come straight from the client and be compared
  // against the policy — so a device sending `dwellSeconds: 9999` counted
  // immediately and the whole confirmation mechanism was decorative.
  //
  // Now `detected` opens a detection stamped with the *database's* clock, and
  // `confirm` presents it. The elapsed dwell handed to the command is measured
  // between two server timestamps; nothing the device reports enters the
  // arithmetic. A phone whose clock is days out is counted correctly.
  // ---------------------------------------------------------------------
  let serverDwellSeconds: number | null = null;
  let detectionId: string | null = null;
  let confirmationNotBefore: string | null = null;

  if (input.source === "geofence") {
    if (input.phase === "detected") {
      const opened = await openDetection(admin, {
        occurrenceId: occurrenceId,
        memberId: link.memberId,
        accountId: account.id,
        attemptId: input.attemptId ?? idempotencyKey,
        regionId: input.regionId,
        configVersion: input.configVersion,
        clientObservedAt: input.observedAt,
      });

      if (!opened) return reject("occurrence_not_found", occurrenceId);

      detectionId = opened.detectionId;
      confirmationNotBefore = opened.confirmationNotBefore;
      // A detection has just opened, so no time has elapsed. The command will
      // answer `pending_confirmation` for any church that requires one.
      serverDwellSeconds = 0;
    } else {
      // A confirmation must present a detection. Without one there is no
      // server-side start time, and accepting the client's word for how long
      // it had been there is exactly the hole this closes.
      if (!input.detectionId) {
        return reject("confirmation_without_detection", occurrenceId);
      }

      const redeemed = await redeemDetection(admin, {
        detectionId: input.detectionId,
        occurrenceId: occurrenceId,
        memberId: link.memberId,
        accountId: account.id,
        regionId: input.regionId,
        configVersion: input.configVersion,
      });

      if (!redeemed.ok) {
        return reject(redeemed.reason as AttendanceReason, occurrenceId);
      }
      serverDwellSeconds = redeemed.serverDwellSeconds;
    }
  }

  const result = await recordAttendance(
    {
      occurrenceId: occurrenceId,
      memberId: link.memberId,
      source: input.source,
      actorType: "visitor",
      idempotencyKey,
      accountId: account.id,
      observedAt: input.observedAt ?? null,
      // A QR scan is presence by possession of a code shown at the service, so
      // there is no geometry to check. A geofence attempt is banded **here**,
      // by the server, against the campus position this occurrence snapshotted
      // — never against anything the client supplied, and never by trusting a
      // claim of being inside.
      //
      // This previously passed `'inside'` unconditionally, which made the
      // command's `outside_region` branch unreachable and contradicted what
      // the architecture document promised. A geofence attempt with no usable
      // coordinates now bands `unknown` and is refused.
      //
      // The coordinates end here: they are not stored, logged, or returned.
      distanceBand:
        input.source === "qr"
          ? "inside"
          : bandForAttempt({
              reported: { latitude: input.latitude, longitude: input.longitude },
              campus: {
                latitude: occurrence.campus_latitude as number | null,
                longitude: occurrence.campus_longitude as number | null,
                radiusMeters: occurrence.geofence_radius_m as number | null,
              },
              accuracyMeters: input.accuracyMeters,
              maxAccuracyMeters: maxAccuracy,
            }),
      accuracyBand:
        input.source === "qr" ? "high" : accuracyBand(input.accuracyMeters, maxAccuracy),
      // **Never the client's number.** For a geofence attempt this is measured
      // between two server timestamps; the client's `dwellSeconds` is not read
      // at all. QR carries no dwell.
      dwellSeconds: input.source === "qr" ? null : (serverDwellSeconds ?? 0),
    },
    admin,
  );

  const outcome = contractOutcome(result.outcome);

  const countedAt =
    outcome === "counted" || outcome === "already_counted"
      ? await factCountedAt(admin, result.factId)
      : null;

  return {
    outcome,
    message: displayMessageFor(result.reason),
    occurrenceId: result.occurrenceId,
    countedAt,
    // Scheduling information for the client, and nothing more: the server
    // enforces the same deadline again on the confirmation.
    confirmationNotBefore:
      outcome === "pending_confirmation" ? confirmationNotBefore : null,
    detectionId: outcome === "pending_confirmation" ? detectionId : null,
  };
}

/**
 * An outcome the mobile contract can carry.
 *
 * `record_attendance` replays a stored attempt's status verbatim for a repeated
 * idempotency key, and an attempt can be `expired`: the cleanup job expires one
 * left waiting on dwell after its window closed, and withdrawing consent closes
 * one too. `expired` is not in the contract's outcome enum, so a phone retrying
 * that key would have received a body it cannot decode. It is a refusal, and it
 * is reported as one.
 */
export function contractOutcome(outcome: string): AttendanceOutcome {
  return (ATTENDANCE_OUTCOMES as readonly string[]).includes(outcome)
    ? (outcome as AttendanceOutcome)
    : "rejected";
}

/**
 * When the person was actually counted.
 *
 * "Already counted" means someone was counted earlier, by this phone, a greeter
 * or a scan, and reporting the moment of this request as when would be wrong.
 */
async function factCountedAt(
  admin: ReturnType<typeof createAdminClient>,
  factId: string | null,
): Promise<string> {
  if (factId) {
    const { data: fact } = await admin
      .from("attendance_facts")
      .select("counted_at")
      .eq("id", factId)
      .maybeSingle();
    if (fact?.counted_at) return new Date(fact.counted_at as string).toISOString();
  }
  return new Date().toISOString();
}

/**
 * How many automatic check-in submissions an account may make.
 *
 * Sixty per ten minutes. The clients' own policy (a token bucket of twelve
 * refilling at one a minute, with an exponential cooldown) cannot exceed about
 * twenty-two attempts, forty-four requests with confirmations, in any ten
 * minutes, so an honest phone never meets this. What it bounds is a client that
 * ignores that policy: every accepted `detected` writes a detection, and every
 * submission is a distance computation.
 *
 * Keyed by account alone, never by position or occurrence, so the limiter
 * stores nothing about where anyone was. Fails closed, like every other use of
 * `checkRateLimit`.
 */
const AUTOMATIC_ATTEMPT_BUDGET = { limit: 60, windowMs: 10 * 60 * 1000 };

async function throttleAutomaticAttempt(accountId: string): Promise<boolean> {
  const result = await checkRateLimit(
    `attendance:geofence:${accountId}`,
    AUTOMATIC_ATTEMPT_BUDGET,
  );
  return !result.ok;
}

/**
 * How many code attempts an account gets, and over what window.
 *
 * The short code is the sensitive one. Seven characters from a 23-character
 * alphabet is about 31.6 bits, which is far beyond guessing at these rates —
 * but only because the rate is enforced. Ten attempts per five minutes is more
 * than anyone needs to type a code off a screen, including with a typo or two,
 * and it turns a blind search into something that would take longer than the
 * universe has run.
 *
 * A scan is throttled more loosely. A camera that catches a stale frame during
 * a rotation legitimately retries, and refusing that would be a worse failure
 * than the one it prevents.
 *
 * `checkRateLimit` is atomic in SQL and **fails closed**: if the limiter is
 * unavailable, the attempt is refused rather than waved through.
 */
const SHORT_CODE_BUDGET = { limit: 10, windowMs: 5 * 60 * 1000 };
const QR_SCAN_BUDGET = { limit: 40, windowMs: 5 * 60 * 1000 };

async function throttleCodeAttempt(
  accountId: string,
  input: AttemptInput,
): Promise<boolean> {
  const typed = Boolean(input.shortCode);
  const budget = typed ? SHORT_CODE_BUDGET : QR_SCAN_BUDGET;
  // The key names the account and the kind of attempt, never the code. A raw
  // code must not reach the limiter, because the limiter hashes and stores what
  // it is given.
  const result = await checkRateLimit(
    `attendance:code:${typed ? "typed" : "scan"}:${accountId}`,
    budget,
  );
  return !result.ok;
}

/**
 * Maps a redemption failure onto a reason.
 *
 * **Typed codes collapse to one.** A person guessing must not learn whether
 * they hit a real code that had expired or nothing at all, so `expired`,
 * `invalid`, and a stopped display are all `short_code_invalid`.
 *
 * A scanned token does not need that treatment. It is signed and carries its
 * own expiry, so its holder can already read why it failed; hiding the reason
 * from them would cost a useful message and reveal nothing they lacked.
 */
function reasonForRedemption(
  reason: "expired" | "invalid" | "unavailable",
  typed: boolean,
): AttendanceReason {
  if (typed) return reason === "unavailable" ? "internal_error" : "short_code_invalid";
  switch (reason) {
    case "expired":
      return "qr_expired";
    case "invalid":
      return "qr_wrong_church";
    default:
      return "internal_error";
  }
}

async function openDetection(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    occurrenceId: string;
    memberId: string;
    accountId: string;
    attemptId: string;
    regionId?: string;
    configVersion?: number;
    clientObservedAt?: string;
  },
): Promise<{ detectionId: string; confirmationNotBefore: string } | null> {
  const { data, error } = await admin.rpc("open_attendance_detection", {
    p_occurrence_id: input.occurrenceId,
    p_member_id: input.memberId,
    p_account_id: input.accountId,
    p_logical_attempt_id: input.attemptId,
    p_region_id: input.regionId ?? null,
    p_config_version: input.configVersion ?? null,
    // Untrusted, and stored for diagnostics only. A plausibility bound stops a
    // wild value reaching the column; nothing here decides anything.
    p_client_observed_at: plausibleObservedAt(input.clientObservedAt),
    p_lifetime_seconds: DETECTION_LIFETIME_SECONDS,
  });

  if (error) return null;
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  return {
    detectionId: row.detection_id as string,
    confirmationNotBefore: new Date(
      row.confirmation_not_before as string,
    ).toISOString(),
  };
}

async function redeemDetection(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    detectionId: string;
    occurrenceId: string;
    memberId: string;
    accountId: string;
    regionId?: string;
    configVersion?: number;
  },
): Promise<{ ok: boolean; reason: string; serverDwellSeconds: number }> {
  const { data, error } = await admin.rpc("redeem_attendance_detection", {
    p_detection_id: input.detectionId,
    p_occurrence_id: input.occurrenceId,
    p_member_id: input.memberId,
    p_account_id: input.accountId,
    p_region_id: input.regionId ?? null,
    p_config_version: input.configVersion ?? null,
  });

  // A malformed uuid makes the driver error rather than return a row. Treated
  // as a fabricated id, which is what it is.
  if (error) return { ok: false, reason: "detection_not_found", serverDwellSeconds: 0 };

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return { ok: false, reason: "detection_not_found", serverDwellSeconds: 0 };

  return {
    ok: Boolean(row.ok),
    reason: row.reason as string,
    serverDwellSeconds: Number(row.server_dwell_seconds ?? 0),
  };
}

/**
 * Bounds an untrusted timestamp before it is stored.
 *
 * The value is diagnostics — it records what the device believed — so a wildly
 * implausible one is dropped rather than rejected: a phone with a broken clock
 * should still be able to check in.
 */
function plausibleObservedAt(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  const skewMs = Math.abs(parsed - Date.now());
  // A year in either direction. Anything beyond that is not a clock error worth
  // recording, and storing it would only make the column harder to read.
  if (skewMs > 365 * 24 * 60 * 60 * 1000) return null;

  return new Date(parsed).toISOString();
}

function reject(reason: AttendanceReason, occurrenceId: string | null) {
  return {
    outcome: "rejected" as const,
    message: displayMessageFor(reason),
    occurrenceId,
    countedAt: null,
    // A refusal is terminal for this attempt: there is nothing to come back for.
    confirmationNotBefore: null,
    detectionId: null,
  };
}

export async function getAttendanceStatus(userId: string, occurrenceId: string) {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const admin = createAdminClient();
  const { data: occurrence } = await admin
    .from("service_occurrences")
    .select("church_id")
    .eq("id", occurrenceId)
    .maybeSingle();

  if (!occurrence) return null;

  const link = await resolveSelfCheckInMember(
    account.id,
    occurrence.church_id as string,
    admin,
  );
  if (!link.ok) {
    return { occurrenceId, isCounted: false, status: null, source: null, countedAt: null };
  }

  const { data: fact } = await admin
    .from("attendance_facts")
    .select("status, source, counted_at")
    .eq("service_occurrence_id", occurrenceId)
    .eq("member_id", link.memberId)
    .maybeSingle();

  return {
    occurrenceId,
    isCounted: fact?.status === "active",
    status: (fact?.status as "active" | "reversed" | null) ?? null,
    source: (fact?.source as string | null) ?? null,
    countedAt: (fact?.counted_at as string | null) ?? null,
  };
}

/**
 * The account's own attendance history for one church.
 *
 * Only what the linked People record shows, and only for the church whose link
 * is active. A reversed fact is included and labelled — someone should be able
 * to see that a check-in was removed.
 */
export async function getOwnHistory(
  userId: string,
  churchSlug: string,
  limit: number,
) {
  const churchId = await resolveChurchId(churchSlug);
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const link = await resolveSelfCheckInMember(account.id, churchId);
  if (!link.ok) return { items: [], nextCursor: null };

  const history = await getMemberHistory(churchId, link.memberId, limit);

  return {
    items: history.map((entry) => ({
      occurrenceId: entry.occurrenceId,
      label: entry.label,
      localServiceDate: entry.localServiceDate,
      campusName: entry.campusName,
      source: entry.source,
      status: entry.status,
      countedAt: entry.countedAt,
    })),
    nextCursor: null,
  };
}
