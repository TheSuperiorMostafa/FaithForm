import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  keyedHash,
  keyedHashCandidates,
  mintCapability,
  packUuid,
  unpackUuid,
  verifyCapability,
  derivedValue,
} from "@/lib/attendance/v2/signing";
import {
  deriveShortCode,
  formatShortCode,
  normalizeShortCode,
  shortCodeCandidatesForWindow,
  shortCodeHashCandidates,
} from "@/lib/attendance/v2/short-code";

/**
 * A pastor's rotating check-in display, from "start it" to "someone scanned it".
 *
 * ## Why a session at all
 *
 * Prompt 6 minted a signed QR on demand: valid for fifteen minutes, tied to
 * nothing, stoppable by nothing. That is a capability with no off switch. A
 * screenshot taken at 10:05 still worked at 10:19, and a church that realised
 * a code had leaked had no way to invalidate it short of rotating a global
 * signing key and breaking every other church at the same time.
 *
 * A session fixes both. The signature still proves the server minted the token;
 * the session proves the display is *still running*, and that half can be
 * revoked in one statement by the person standing at the front.
 *
 * ## Why the code is derived rather than drawn
 *
 * Two browser tabs, a projector that reloads, and a poll that arrives a second
 * late must all show the same code — otherwise a room sees one code while a
 * phone is told a different one is current. Coordinating that through the
 * database on every poll would make the display's liveness depend on a write.
 *
 * Instead the code for a rotation window is a pure function of the signing key,
 * the session, and the window index. Everyone computes it; nobody negotiates it.
 * The database row exists only so that a *typed* code can be looked up in
 * reverse, which an HMAC cannot do.
 *
 * ## What rotation actually buys, stated honestly
 *
 * A rotating code raises the cost of sharing a screenshot: by the time an image
 * reaches someone at home the code behind it is stale, so the sharer has to
 * relay a fresh one every rotation period, live. That is a real deterrent
 * against casual sharing.
 *
 * It is **not** proof of physical presence. Anyone willing to relay codes in
 * real time — a video call pointed at the screen, a person texting the code
 * every thirty seconds — defeats it, and no QR system can detect that from a
 * signature. Faithful does not claim otherwise anywhere in its interface or its
 * documentation. Presence evidence, where a church wants it, comes from the
 * geofence path built in Prompts 6 and 7, and even that is evidence rather than
 * proof.
 */

export const DEFAULT_ROTATION_SECONDS = 30;
export const MIN_ROTATION_SECONDS = 15;
export const MAX_ROTATION_SECONDS = 120;

/**
 * How long a code stays valid past the end of its window.
 *
 * Without this, someone who raised their phone one second before the rotation
 * would be refused for a reason they could not possibly have anticipated. One
 * extra window is enough for a scan already in progress and short enough that a
 * relayed code is still stale within a minute.
 */
export const ROTATION_GRACE_WINDOWS = 1;

/** A pairing code is typed within a minute or two of being read, or not at all. */
export const PAIRING_TTL_SECONDS = 300;

export type CheckinSession = {
  sessionId: string;
  occurrenceId: string;
  churchId: string;
  rotationSeconds: number;
  expiresAt: string;
};

/** The rotation window an instant falls in. Epoch-aligned, so it is shared. */
export function windowIndexFor(nowSeconds: number, rotationSeconds: number): number {
  return Math.floor(nowSeconds / rotationSeconds);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type StartResult =
  | { ok: true; session: CheckinSession; wasExisting: boolean }
  | { ok: false; reason: string };

/**
 * Starts, or rejoins, the display for one occurrence.
 *
 * The church is passed so the database can compare it against the occurrence's
 * own — a caller naming another tenant's occurrence gets `occurrence_not_found`,
 * the same answer as a caller naming one that does not exist. The two are
 * deliberately indistinguishable.
 */
export async function startCheckinSession(input: {
  occurrenceId: string;
  churchId: string;
  actorUserId: string;
  rotationSeconds?: number;
  client?: SupabaseClient;
}): Promise<StartResult> {
  const admin = input.client ?? createAdminClient();

  const rotation = Math.min(
    MAX_ROTATION_SECONDS,
    Math.max(MIN_ROTATION_SECONDS, input.rotationSeconds ?? DEFAULT_ROTATION_SECONDS),
  );

  const { data, error } = await admin.rpc("start_attendance_checkin_session", {
    p_occurrence_id: input.occurrenceId,
    p_church_id: input.churchId,
    p_actor_user_id: input.actorUserId,
    p_rotation_seconds: rotation,
  });

  if (error) return { ok: false, reason: "unavailable" };
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.ok) return { ok: false, reason: (row?.reason as string) ?? "unavailable" };

  return {
    ok: true,
    wasExisting: Boolean(row.was_existing),
    session: {
      sessionId: row.session_id as string,
      occurrenceId: input.occurrenceId,
      churchId: input.churchId,
      rotationSeconds: Number(row.rotation_seconds),
      expiresAt: row.expires_at as string,
    },
  };
}

export async function endCheckinSession(input: {
  sessionId: string;
  churchId: string;
  actorUserId: string;
  client?: SupabaseClient;
}): Promise<boolean> {
  const admin = input.client ?? createAdminClient();
  const { data, error } = await admin.rpc("end_attendance_checkin_session", {
    p_session_id: input.sessionId,
    p_church_id: input.churchId,
    p_actor_user_id: input.actorUserId,
  });
  return !error && Boolean(data);
}

/** The live session for an occurrence, if any. Used by the dashboard board. */
export async function getActiveSession(input: {
  occurrenceId: string;
  churchId: string;
  client?: SupabaseClient;
}): Promise<CheckinSession | null> {
  const admin = input.client ?? createAdminClient();
  const { data } = await admin
    .from("attendance_checkin_sessions")
    .select("id, church_id, service_occurrence_id, rotation_seconds, expires_at")
    .eq("service_occurrence_id", input.occurrenceId)
    .eq("church_id", input.churchId)
    .eq("status", "active")
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at as string) <= new Date()) return null;

  return {
    sessionId: data.id as string,
    occurrenceId: data.service_occurrence_id as string,
    churchId: data.church_id as string,
    rotationSeconds: Number(data.rotation_seconds),
    expiresAt: data.expires_at as string,
  };
}

// ---------------------------------------------------------------------------
// The displayed frame
// ---------------------------------------------------------------------------

export type DisplayFrame = {
  /** The signed capability encoded into the QR image. */
  qrToken: string;
  /** The same capability as characters. `null` if no code could be claimed. */
  shortCode: string | null;
  shortCodeDisplay: string | null;
  windowIndex: number;
  /** When this frame stops being displayed — the next rotation boundary. */
  rotatesAt: string;
  /** When it stops being *accepted*, one grace window later. */
  expiresAt: string;
  rotationSeconds: number;
};

/**
 * Produces the frame for the current rotation window.
 *
 * Called by the display on every poll and by nothing else. The QR is minted
 * unconditionally; the short code additionally needs a database row so that a
 * typed code can be reversed, and if that row cannot be claimed the frame comes
 * back with `shortCode: null` rather than showing characters that might resolve
 * to another church's service.
 */
export async function currentDisplayFrame(
  session: CheckinSession,
  client?: SupabaseClient,
): Promise<DisplayFrame | null> {
  const admin = client ?? createAdminClient();

  const rotation = session.rotationSeconds;
  const now = nowSeconds();
  const windowIndex = windowIndexFor(now, rotation);

  const windowStart = windowIndex * rotation;
  const windowEnd = windowStart + rotation;
  const acceptUntil = windowEnd + rotation * ROTATION_GRACE_WINDOWS;

  const nonce = derivedValue("checkin.qr", `${session.sessionId}|${windowIndex}`, 12);
  const packedSession = packUuid(session.sessionId);
  const packedOccurrence = packUuid(session.occurrenceId);
  if (!nonce || !packedSession || !packedOccurrence) return null;

  const qrToken = mintCapability("checkin.qr", {
    v: 2,
    s: packedSession,
    o: packedOccurrence,
    w: windowIndex,
    n: nonce,
    e: acceptUntil,
  });
  if (!qrToken) return null;

  // The short code needs a reverse-lookup row. Everything else about the frame
  // is derived, so a failure here costs the typed fallback and nothing more.
  const { codes, hashes } = shortCodeCandidatesForWindow(session.sessionId, windowIndex);
  let shortCode: string | null = null;

  if (hashes.length > 0) {
    const { data } = await admin.rpc("claim_attendance_checkin_code", {
      p_session_id: session.sessionId,
      p_window_index: windowIndex,
      p_code_hashes: hashes,
      p_nonce: nonce,
      p_valid_from: new Date(windowStart * 1000).toISOString(),
      p_valid_until: new Date(acceptUntil * 1000).toISOString(),
    });

    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (row?.ok) {
      const attempt = Number(row.derivation_attempt ?? 0);
      // Re-derive rather than trust the array index: a poll that lost the race
      // gets the *winner's* attempt number back, which may not be its own.
      shortCode = deriveShortCode(session.sessionId, windowIndex, attempt) ?? codes[attempt] ?? null;
    }
  }

  return {
    qrToken,
    shortCode,
    shortCodeDisplay: shortCode ? formatShortCode(shortCode) : null,
    windowIndex,
    rotatesAt: new Date(windowEnd * 1000).toISOString(),
    expiresAt: new Date(acceptUntil * 1000).toISOString(),
    rotationSeconds: rotation,
  };
}

// ---------------------------------------------------------------------------
// Redemption — what a scanned or typed code resolves to
// ---------------------------------------------------------------------------

export type RedeemedCode = {
  sessionId: string;
  occurrenceId: string;
  churchId: string;
  nonce: string;
  entryMethod: "qr" | "short_code";
};

export type CodeRedemption =
  | { ok: true; resolved: RedeemedCode }
  | { ok: false; reason: "expired" | "invalid" | "unavailable" };

type QrBody = { v: number; s: string; o: string; w: number; n: string; e: number };

/**
 * Resolves a scanned QR token.
 *
 * Two independent checks, and both must hold:
 *
 *  1. **The signature**, which proves this server minted it and that the body
 *     has not been touched. Nothing in the body is read before this passes.
 *  2. **The session**, which proves the display is still running. A signature
 *     cannot be revoked; a session can, and this is how "stop the display"
 *     takes effect within one poll.
 *
 * What this deliberately does **not** do is authorise anyone. The token says
 * which check-in session is live. Who the person is comes from their
 * authenticated account and their verified People link, resolved separately by
 * the attendance service — a token holder with no link is not counted, and a
 * token is not an identity.
 */
export async function resolveScannedToken(
  token: string | null | undefined,
  client?: SupabaseClient,
): Promise<CodeRedemption> {
  const verified = verifyCapability<QrBody>("checkin.qr", token);
  if (!verified.ok) {
    // A token minted under a key this deployment has rotated past reads as
    // expired, because that is what it is from the holder's point of view.
    return { ok: false, reason: verified.reason === "unknown_key" ? "expired" : "invalid" };
  }

  const body = verified.body;
  if (typeof body.e !== "number" || body.e <= nowSeconds()) {
    return { ok: false, reason: "expired" };
  }

  const sessionId = unpackUuid(String(body.s ?? ""));
  const occurrenceId = unpackUuid(String(body.o ?? ""));
  const nonce = typeof body.n === "string" ? body.n : null;
  if (!sessionId || !occurrenceId || !nonce) return { ok: false, reason: "invalid" };

  const admin = client ?? createAdminClient();
  const { data, error } = await admin.rpc("resolve_attendance_checkin_session", {
    p_session_id: sessionId,
  });
  if (error) return { ok: false, reason: "unavailable" };

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.ok) return { ok: false, reason: "expired" };

  // The occurrence is in the signed body *and* on the session row. They agree
  // unless something has gone wrong, and if they disagree the signed claim is
  // not the one to trust.
  if ((row.service_occurrence_id as string) !== occurrenceId) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    resolved: {
      sessionId,
      occurrenceId,
      churchId: row.church_id as string,
      nonce,
      entryMethod: "qr",
    },
  };
}

/**
 * Resolves a typed short code.
 *
 * **Every failure returns the same reason.** Unknown, expired, malformed, and
 * belonging-to-a-stopped-display are one answer, because distinguishing them
 * tells someone guessing whether their guess was a real code — which is the
 * only feedback that makes guessing a 31-bit space worth attempting.
 *
 * Rate limiting is the caller's job and is not optional; this function is a
 * lookup, and a lookup without a budget is an oracle.
 */
export async function resolveTypedShortCode(
  input: string | null | undefined,
  client?: SupabaseClient,
): Promise<CodeRedemption> {
  const normalized = normalizeShortCode(input);
  if (!normalized) return { ok: false, reason: "invalid" };

  const candidates = shortCodeHashCandidates(normalized);
  if (candidates.length === 0) return { ok: false, reason: "unavailable" };

  const admin = client ?? createAdminClient();

  // Current key first, then the previous one during a rotation grace. Two index
  // probes at worst.
  for (const hash of candidates) {
    const { data, error } = await admin.rpc("redeem_attendance_short_code", {
      p_code_hash: hash,
    });
    if (error) return { ok: false, reason: "unavailable" };

    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (row?.ok) {
      return {
        ok: true,
        resolved: {
          sessionId: row.session_id as string,
          occurrenceId: row.service_occurrence_id as string,
          churchId: row.church_id as string,
          nonce: row.nonce as string,
          entryMethod: "short_code",
        },
      };
    }
  }

  return { ok: false, reason: "invalid" };
}

/** Records which rotating code an account presented. Audit only; never a gate. */
export async function recordScan(input: {
  occurrenceId: string;
  accountId: string;
  churchId: string;
  nonce: string;
  entryMethod: "qr" | "short_code";
  client?: SupabaseClient;
}): Promise<void> {
  const admin = input.client ?? createAdminClient();
  await admin.rpc("record_attendance_qr_scan", {
    p_occurrence_id: input.occurrenceId,
    p_account_id: input.accountId,
    p_church_id: input.churchId,
    p_nonce: input.nonce,
    p_entry_method: input.entryMethod,
  });
}

// ---------------------------------------------------------------------------
// Display pairing
// ---------------------------------------------------------------------------

export type DisplayCapabilityBody = { v: number; s: string; o: string; c: string; e: number };

/**
 * Issues a one-time pairing code for a projector.
 *
 * The raw code is returned once and never stored — only its keyed hash goes to
 * the database, so a copy of the table pairs nothing.
 */
export async function issueDisplayPairing(input: {
  sessionId: string;
  churchId: string;
  actorUserId: string;
  client?: SupabaseClient;
}): Promise<{ code: string; display: string; expiresAt: string } | null> {
  const admin = input.client ?? createAdminClient();

  // Drawn at random rather than derived: a pairing code has no window to be a
  // function of, and two pastors starting two displays must not collide.
  const code = randomPairingCode();
  const hash = keyedHash("checkin.pairing", code);
  if (!hash) return null;

  const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000).toISOString();

  const { error } = await admin.from("attendance_display_pairings").insert({
    session_id: input.sessionId,
    church_id: input.churchId,
    code_hash: hash,
    expires_at: expiresAt,
    created_by: input.actorUserId,
  });

  if (error) return null;
  return { code, display: formatShortCode(code), expiresAt };
}

/**
 * Spends a pairing code and returns the display capability.
 *
 * The capability is the whole point of the pairing step: what ends up on the
 * projector is a token that can read one occurrence's current code and can do
 * nothing else at all. It carries no user, no role, no church-wide authority,
 * and no ability to write anything.
 */
export async function redeemDisplayPairing(
  typedCode: string,
  client?: SupabaseClient,
): Promise<
  | { ok: true; capability: string; session: CheckinSession }
  | { ok: false; reason: "invalid" | "unavailable" }
> {
  const normalized = normalizeShortCode(typedCode);
  if (!normalized) return { ok: false, reason: "invalid" };

  const candidates = keyedHashCandidates("checkin.pairing", normalized);
  if (candidates.length === 0) return { ok: false, reason: "unavailable" };

  const admin = client ?? createAdminClient();

  for (const hash of candidates) {
    const { data, error } = await admin.rpc("redeem_attendance_display_pairing", {
      p_code_hash: hash,
    });
    if (error) return { ok: false, reason: "unavailable" };

    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (!row?.ok) continue;

    const sessionId = row.session_id as string;
    const occurrenceId = row.service_occurrence_id as string;
    const churchId = row.church_id as string;
    const expiresAt = row.session_expires_at as string;

    const packedSession = packUuid(sessionId);
    const packedOccurrence = packUuid(occurrenceId);
    const packedChurch = packUuid(churchId);
    if (!packedSession || !packedOccurrence || !packedChurch) {
      return { ok: false, reason: "unavailable" };
    }

    const capability = mintCapability("checkin.display", {
      v: 2,
      s: packedSession,
      o: packedOccurrence,
      c: packedChurch,
      // Never outlives the session it displays.
      e: Math.floor(new Date(expiresAt).getTime() / 1000),
    });
    if (!capability) return { ok: false, reason: "unavailable" };

    return {
      ok: true,
      capability,
      session: {
        sessionId,
        occurrenceId,
        churchId,
        rotationSeconds: Number(row.rotation_seconds),
        expiresAt,
      },
    };
  }

  return { ok: false, reason: "invalid" };
}

/**
 * Verifies a display capability presented by a projector.
 *
 * Signature, then expiry, then the session — the same order and the same
 * revocability as a scanned token. A display whose session was stopped stops
 * receiving frames without anyone touching the projector.
 */
export async function verifyDisplayCapability(
  token: string | null | undefined,
  client?: SupabaseClient,
): Promise<{ ok: true; session: CheckinSession } | { ok: false; reason: string }> {
  const verified = verifyCapability<DisplayCapabilityBody>("checkin.display", token);
  if (!verified.ok) return { ok: false, reason: "invalid" };

  const body = verified.body;
  if (typeof body.e !== "number" || body.e <= nowSeconds()) {
    return { ok: false, reason: "expired" };
  }

  const sessionId = unpackUuid(String(body.s ?? ""));
  const occurrenceId = unpackUuid(String(body.o ?? ""));
  const churchId = unpackUuid(String(body.c ?? ""));
  if (!sessionId || !occurrenceId || !churchId) return { ok: false, reason: "invalid" };

  const admin = client ?? createAdminClient();
  const { data, error } = await admin.rpc("resolve_attendance_checkin_session", {
    p_session_id: sessionId,
  });
  if (error) return { ok: false, reason: "unavailable" };

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.ok) return { ok: false, reason: "ended" };
  if ((row.service_occurrence_id as string) !== occurrenceId) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    session: {
      sessionId,
      occurrenceId,
      churchId: row.church_id as string,
      rotationSeconds: Number(row.rotation_seconds),
      expiresAt: new Date(body.e * 1000).toISOString(),
    },
  };
}

/**
 * A pairing code, drawn from the same alphabet a person can read aloud.
 *
 * Seven characters, uniformly sampled with rejection so no character is
 * favoured. It lives for five minutes and is single-use, which is what makes
 * seven characters the right length rather than a compromise.
 */
function randomPairingCode(): string {
  const alphabet = "BCDFGHJKLMNPQRTVWXY3479";
  const limit = 256 - (256 % alphabet.length);
  const characters: string[] = [];

  while (characters.length < 7) {
    for (const byte of randomBytes(32)) {
      if (byte >= limit) continue;
      characters.push(alphabet[byte % alphabet.length]);
      if (characters.length === 7) break;
    }
  }
  return characters.join("");
}
