/**
 * The attendance result vocabulary.
 *
 * These are the outcomes the one transactional command can produce. They are
 * the contract between every source and every caller: a native client, the
 * dashboard, and a kiosk all reason about the same set.
 *
 * Deliberately distinct from the mobile error vocabulary — `already_counted` is
 * a success, not an error, and collapsing the two would make a retried
 * check-in look like a failure.
 */
export const ATTENDANCE_OUTCOMES = [
  "counted",
  "already_counted",
  "pending_confirmation",
  "rejected",
  "reversed",
] as const;

export type AttendanceOutcome = (typeof ATTENDANCE_OUTCOMES)[number];

export const ATTENDANCE_REASONS = [
  "ok",
  "already_counted",
  "awaiting_dwell",
  "too_early",
  "too_late",
  "occurrence_cancelled",
  "occurrence_not_found",
  "source_disabled",
  "no_people_link",
  "member_not_in_church",
  "consent_required",
  "consent_revoked",
  "relationship_revoked",
  "outside_region",
  "insufficient_accuracy",
  "qr_expired",
  // **No longer produced.** Prompt 6 consumed a QR nonce globally, so the
  // second person to scan the code on the projector collided and was refused.
  // A displayed code is meant to be used by everyone looking at it, and the
  // unique counted fact — not a nonce lock — is what stops double-counting.
  // Kept in the vocabulary because attempt rows already recorded with it must
  // remain readable; `tests/security/checkin-authority.test.ts` asserts nothing
  // emits it any more.
  "qr_replayed",
  "qr_wrong_church",
  // The pastor stopped the display, or it reached its hard bound. Distinct from
  // an expired code: the code may still be inside its rotation window.
  "checkin_session_ended",
  // **One reason for every way a typed code can fail.** Unknown, expired,
  // malformed, and belonging-to-a-stopped-display are deliberately
  // indistinguishable, because telling someone which one they hit tells them
  // whether they guessed a real code.
  "short_code_invalid",
  // Too many code attempts. Distinguished on purpose — it is the one refusal
  // where the person needs to know that waiting helps, and it reveals nothing
  // about any code.
  "code_throttled",
  "kiosk_unauthorized",
  // A kiosk that locked itself after sitting idle. A staff instruction, not a
  // failure.
  "kiosk_locked",
  // Detection failures. A confirmation presents a server-issued detection, and
  // every one of these is a way that capability can fail to hold: fabricated,
  // spent, expired, replayed across a boundary, or presented too soon. Kept
  // distinct so the attempt audit says which — a support question about "it
  // said no" is answerable only if the row remembers why.
  "confirmation_without_detection",
  "detection_not_found",
  "detection_expired",
  "detection_already_used",
  "detection_wrong_account",
  "detection_wrong_member",
  "detection_wrong_occurrence",
  "detection_wrong_region",
  "detection_stale_configuration",
  "dwell_not_elapsed",
  "reversed",
  "internal_error",
] as const;

export type AttendanceReason = (typeof ATTENDANCE_REASONS)[number];

export type AttendanceResult = {
  outcome: AttendanceOutcome;
  reason: AttendanceReason;
  /** Present only when a fact exists — counted, already counted, or reversed. */
  factId: string | null;
  attemptId: string | null;
  occurrenceId: string | null;
};

/**
 * Maps an attendance reason onto Prompt 4's mobile error vocabulary.
 *
 * An explicit table rather than a passthrough: the attendance vocabulary is
 * free to grow for the dashboard's own reasons, and a reason with no mobile
 * meaning must degrade to something safe rather than leak an internal name.
 *
 * Note what is *absent*: `member_not_in_church` maps to a generic forbidden
 * rather than telling a caller their member id was wrong for this tenant.
 */
const REASON_TO_MOBILE: Record<AttendanceReason, string> = {
  ok: "ok",
  already_counted: "ok",
  awaiting_dwell: "ok",
  too_early: "conflict",
  too_late: "conflict",
  occurrence_cancelled: "conflict",
  occurrence_not_found: "not_found",
  source_disabled: "forbidden",
  no_people_link: "forbidden",
  member_not_in_church: "forbidden",
  consent_required: "forbidden",
  consent_revoked: "forbidden",
  relationship_revoked: "blocked",
  outside_region: "conflict",
  insufficient_accuracy: "conflict",
  qr_expired: "invitation_expired",
  qr_replayed: "conflict",
  qr_wrong_church: "forbidden",
  checkin_session_ended: "conflict",
  // Deliberately the same code as an expired QR. A client cannot tell a wrong
  // code from a stale one, which is the point.
  short_code_invalid: "invitation_expired",
  code_throttled: "rate_limited",
  kiosk_unauthorized: "unauthenticated",
  kiosk_locked: "unauthenticated",
  // A conflict rather than a forbidden: nothing is wrong with the caller, the
  // state simply is not right yet or no longer is.
  confirmation_without_detection: "conflict",
  detection_not_found: "conflict",
  detection_expired: "conflict",
  detection_already_used: "conflict",
  // Deliberately *not* distinguished on the wire. A caller probing which
  // boundary it crossed learns nothing from the code either.
  detection_wrong_account: "forbidden",
  detection_wrong_member: "forbidden",
  detection_wrong_occurrence: "forbidden",
  detection_wrong_region: "forbidden",
  detection_stale_configuration: "conflict",
  dwell_not_elapsed: "conflict",
  reversed: "conflict",
  internal_error: "internal_error",
};

export function mobileCodeForAttendanceReason(reason: AttendanceReason): string {
  return REASON_TO_MOBILE[reason] ?? "internal_error";
}

/**
 * What a person is told. Deliberately vague about *why* a location attempt
 * failed: telling someone they were "42 m outside the region" is a hint for
 * anyone trying to spoof it.
 */
export function displayMessageFor(reason: AttendanceReason): string {
  switch (reason) {
    case "ok":
    case "already_counted":
      return "You're checked in.";
    case "awaiting_dwell":
      return "Almost there — stay a moment longer.";
    case "too_early":
      return "Check-in isn't open yet.";
    case "too_late":
      return "Check-in has closed for this service.";
    case "occurrence_cancelled":
      return "This service was cancelled.";
    case "source_disabled":
      return "This church hasn't turned on that kind of check-in.";
    case "no_people_link":
      return "Your church needs to confirm who you are first.";
    case "consent_required":
    case "consent_revoked":
      return "Turn on automatic check-in to use this.";
    case "relationship_revoked":
      return "This church is not available to you right now.";
    case "outside_region":
    case "insufficient_accuracy":
    // Every detection failure reads the same as a location failure, on
    // purpose. Telling someone their detection was for the wrong region, or
    // had already been spent, would describe the capability model to anyone
    // probing it — and none of it is actionable for the person reading it.
    case "confirmation_without_detection":
    case "detection_not_found":
    case "detection_expired":
    case "detection_already_used":
    case "detection_wrong_account":
    case "detection_wrong_member":
    case "detection_wrong_occurrence":
    case "detection_wrong_region":
    case "detection_stale_configuration":
      // One message for all, on purpose.
      return "We couldn't confirm you're at the service.";
    case "dwell_not_elapsed":
      // A real instruction, because this one *is* actionable: staying a little
      // longer genuinely works.
      return "Stay a moment longer and we'll check you in.";
    case "qr_expired":
      // Safe to be specific: the token is signed and self-describing, so its
      // holder could read the expiry out of it without being told.
      return "That code has expired — check the screen for a fresh one.";
    case "qr_replayed":
      // Retained for historical attempt rows; nothing produces this now.
      return "That code has already been used.";
    case "qr_wrong_church":
      return "That code isn't for this service.";
    case "checkin_session_ended":
      return "Check-in has stopped for this service.";
    case "short_code_invalid":
      // **Uniform.** A wrong code, a stale one, and one whose display has been
      // stopped all read identically. A person who mistyped tries again; a
      // person guessing learns nothing about whether they were close.
      return "That code didn't work — check the screen and try again.";
    case "code_throttled":
      return "Too many tries. Wait a moment and try again.";
    case "kiosk_unauthorized":
      return "This kiosk isn't set up.";
    case "kiosk_locked":
      return "This kiosk is locked. Ask a volunteer to unlock it.";
    case "reversed":
      return "Your check-in was removed by the church.";
    default:
      return "Something went wrong.";
  }
}
