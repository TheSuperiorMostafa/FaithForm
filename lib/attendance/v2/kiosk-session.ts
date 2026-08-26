import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordAttendance } from "@/lib/attendance/v2/check-in";
import { keyedHash, keyedHashCandidates, randomToken } from "@/lib/attendance/v2/signing";
import { formatShortCode, normalizeShortCode } from "@/lib/attendance/v2/short-code";
import type { AttendanceResult } from "@/lib/attendance/v2/results";

/**
 * Staff kiosk mode.
 *
 * ## The problem this solves, precisely
 *
 * A welcome desk needs a tablet that can check people in. The obvious way to
 * build that is to sign a staff member into the dashboard on the tablet and
 * leave it there — and that is an administrator session on an unattended device
 * in a public room. Whoever picks it up can export People, read giving, change
 * settings, and see every other service.
 *
 * A kiosk session is the opposite of that trade. It is a credential that can do
 * exactly two things:
 *
 *   1. search this church's People, by name, with a bounded result set; and
 *   2. check one of them into **one named occurrence**.
 *
 * It cannot administer the church, export People, change or reverse attendance,
 * read integrations, see giving, or touch any other occurrence — not because
 * the interface hides those, but because the credential resolves to an
 * occurrence and a church and carries no user, no role, and no session.
 *
 * ## Why pairing exists
 *
 * The credential is 32 random bytes. Nobody types that into a tablet. So a staff
 * member starts the kiosk from the dashboard, reads a seven-character code, and
 * types it once; the tablet exchanges it for the real credential and keeps that.
 * The pairing code is single-use, lives five minutes, and is stored only as a
 * keyed hash — so reading it over someone's shoulder after the fact pairs
 * nothing.
 *
 * ## Why it locks itself
 *
 * A kiosk that stays authorised forever is a kiosk that is still authorised on
 * Monday. `idle_lock_seconds` is enforced inside the same statement that touches
 * `last_used_at`, so a tablet left on a table stops resolving and a volunteer
 * has to unlock it again.
 */

export const KIOSK_PAIRING_TTL_SECONDS = 300;
export const DEFAULT_IDLE_LOCK_SECONDS = 300;

/**
 * How much of a name someone must type before anything is returned.
 *
 * **This is the anti-browsing control.** Two characters would let anyone walk
 * up and page through a congregation; an empty query would hand over the
 * directory outright. Three characters plus a prefix match means you have to
 * substantially know who you are looking for.
 */
export const MIN_SEARCH_LENGTH = 3;

/**
 * And how many they may see at once.
 *
 * Small enough that a query cannot be widened into a listing, large enough that
 * a common surname still resolves. A query matching more than this returns the
 * first few and says so, rather than paginating — pagination is browsing.
 */
export const MAX_SEARCH_RESULTS = 8;

export type KioskSession = {
  kioskSessionId: string;
  occurrenceId: string;
  churchId: string;
  campusId: string | null;
  idleLockSeconds: number;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Creates a pending kiosk and returns the code to type into the tablet.
 *
 * The occurrence is fixed here, by a staff member who is signed in, and never
 * again — the tablet cannot change it and no request from the tablet names one.
 */
export async function startKioskSession(input: {
  occurrenceId: string;
  churchId: string;
  actorUserId: string;
  label: string;
  idleLockSeconds?: number;
  client?: SupabaseClient;
}): Promise<{ kioskSessionId: string; pairingCode: string; pairingDisplay: string; expiresAt: string } | null> {
  const admin = input.client ?? createAdminClient();

  // The occurrence bounds the kiosk's life. A check-in station for a service
  // that finished has no reason to keep resolving.
  const { data: occurrence } = await admin
    .from("service_occurrences")
    .select("id, church_id, campus_id, checkin_closes_at_utc, status")
    .eq("id", input.occurrenceId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!occurrence || occurrence.status === "cancelled") return null;

  const expiresAt = new Date(
    new Date(occurrence.checkin_closes_at_utc as string).getTime() + 60 * 60 * 1000,
  );
  if (expiresAt <= new Date()) return null;

  const pairingCode = randomPairingCode();
  const pairingHash = keyedHash("kiosk.pairing", pairingCode);
  if (!pairingHash) return null;

  const idleLock = Math.min(
    1800,
    Math.max(30, input.idleLockSeconds ?? DEFAULT_IDLE_LOCK_SECONDS),
  );

  const { data, error } = await admin
    .from("attendance_kiosk_sessions")
    .insert({
      church_id: input.churchId,
      service_occurrence_id: input.occurrenceId,
      campus_id: (occurrence.campus_id as string | null) ?? null,
      label: input.label.slice(0, 120),
      status: "pending",
      pairing_code_hash: pairingHash,
      pairing_expires_at: new Date(
        Date.now() + KIOSK_PAIRING_TTL_SECONDS * 1000,
      ).toISOString(),
      idle_lock_seconds: idleLock,
      expires_at: expiresAt.toISOString(),
      started_by: input.actorUserId,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return null;

  return {
    kioskSessionId: data.id as string,
    pairingCode,
    pairingDisplay: formatShortCode(pairingCode),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Spends a pairing code and returns the credential the tablet keeps.
 *
 * The raw credential is returned **once** and is never stored — only its keyed
 * hash reaches the database, so a copy of the table authorises nothing.
 */
export async function pairKiosk(
  typedCode: string,
  client?: SupabaseClient,
): Promise<
  | { ok: true; credential: string; session: KioskSession; expiresAt: string }
  | { ok: false; reason: "invalid" | "unavailable" }
> {
  const normalized = normalizeShortCode(typedCode);
  if (!normalized) return { ok: false, reason: "invalid" };

  const pairingHashes = keyedHashCandidates("kiosk.pairing", normalized);
  if (pairingHashes.length === 0) return { ok: false, reason: "unavailable" };

  const credential = randomToken(32);
  const credentialHash = keyedHash("kiosk.credential", credential);
  if (!credentialHash) return { ok: false, reason: "unavailable" };

  const admin = client ?? createAdminClient();

  for (const pairingHash of pairingHashes) {
    const { data, error } = await admin.rpc("pair_attendance_kiosk", {
      p_pairing_code_hash: pairingHash,
      p_credential_hash: credentialHash,
    });
    if (error) return { ok: false, reason: "unavailable" };

    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (!row?.ok) continue;

    return {
      ok: true,
      credential,
      expiresAt: row.expires_at as string,
      session: {
        kioskSessionId: row.kiosk_session_id as string,
        occurrenceId: row.service_occurrence_id as string,
        churchId: row.church_id as string,
        campusId: (row.campus_id as string | null) ?? null,
        idleLockSeconds: Number(row.idle_lock_seconds),
      },
    };
  }

  return { ok: false, reason: "invalid" };
}

export type KioskResolution =
  | { ok: true; session: KioskSession }
  | { ok: false; reason: "unauthorized" | "locked" | "unavailable" };

/**
 * Resolves a presented credential and refreshes the idle clock in one statement.
 *
 * The distinction between `locked` and `unauthorized` is deliberate and narrow:
 * a locked kiosk tells a volunteer to unlock it, which is actionable and
 * reveals nothing to anyone who does not already hold the credential. Everything
 * else — unknown, ended, expired — is one answer.
 */
export async function resolveKioskSession(
  credential: string | null | undefined,
  client?: SupabaseClient,
): Promise<KioskResolution> {
  if (typeof credential !== "string" || credential.length < 16 || credential.length > 256) {
    return { ok: false, reason: "unauthorized" };
  }

  const hashes = keyedHashCandidates("kiosk.credential", credential);
  if (hashes.length === 0) return { ok: false, reason: "unavailable" };

  const admin = client ?? createAdminClient();
  let sawLock = false;

  for (const hash of hashes) {
    const { data, error } = await admin.rpc("resolve_attendance_kiosk_session", {
      p_credential_hash: hash,
    });
    if (error) return { ok: false, reason: "unavailable" };

    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (row?.ok) {
      return {
        ok: true,
        session: {
          kioskSessionId: row.kiosk_session_id as string,
          occurrenceId: row.service_occurrence_id as string,
          churchId: row.church_id as string,
          campusId: (row.campus_id as string | null) ?? null,
          idleLockSeconds: Number(row.idle_lock_seconds),
        },
      };
    }
    if (row?.reason === "idle_locked") sawLock = true;
  }

  return { ok: false, reason: sawLock ? "locked" : "unauthorized" };
}

export async function endKioskSession(input: {
  kioskSessionId: string;
  churchId: string;
  actorUserId: string;
  client?: SupabaseClient;
}): Promise<boolean> {
  const admin = input.client ?? createAdminClient();
  const { error } = await admin
    .from("attendance_kiosk_sessions")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      ended_by: input.actorUserId,
      // The credential stops resolving the moment this is null, so ending is
      // immediate rather than a flag the resolver has to remember to check.
      credential_hash: null,
      pairing_code_hash: null,
    })
    .eq("id", input.kioskSessionId)
    // Exact tenant predicate: an id from another church updates nothing.
    .eq("church_id", input.churchId);

  return !error;
}

// ---------------------------------------------------------------------------
// The bounded search
// ---------------------------------------------------------------------------

export type KioskPerson = {
  memberId: string;
  firstName: string;
  lastName: string;
  /** Already counted at this occurrence, so staff do not tap twice. */
  alreadyCounted: boolean;
};

export type KioskSearchResult = {
  people: KioskPerson[];
  /** True when the query matched more than `MAX_SEARCH_RESULTS`. */
  truncated: boolean;
};

/**
 * Finds people by name, narrowly.
 *
 * Four properties make this a check-in aid rather than a directory:
 *
 *   * **A minimum query length.** Below `MIN_SEARCH_LENGTH` nothing is
 *     returned at all, so there is no "show me everyone" query.
 *   * **Prefix matching, not substring.** `%son%` would surface every Johnson,
 *     Wilson and Jackson from three characters; `son%` surfaces the people
 *     whose name actually starts that way.
 *   * **A hard result cap** with no pagination. Paging is browsing.
 *   * **Three fields.** A name and whether they are already counted. No email,
 *     no phone, no address, no notes, no giving, no household — none of it is
 *     selected, so none of it can leak through a serialisation mistake.
 *
 * The church comes from the kiosk session, never from the request.
 */
export async function searchKioskPeople(input: {
  session: KioskSession;
  query: string;
  client?: SupabaseClient;
}): Promise<KioskSearchResult> {
  const query = input.query.trim();
  if (query.length < MIN_SEARCH_LENGTH) return { people: [], truncated: false };

  const admin = input.client ?? createAdminClient();

  // Escape the LIKE metacharacters. Without this a query of `%` matches
  // everyone, which is the browse this is built to prevent.
  const escape = (value: string) =>
    value.replace(/([\\%_])/g, "\\$1").slice(0, 60);

  const parts = query.split(/\s+/).filter(Boolean).slice(0, 2);

  let builder = admin
    .from("members")
    // **Exactly three columns.**
    .select("id, first_name, last_name")
    .eq("church_id", input.session.churchId)
    .eq("is_active", true);

  if (parts.length >= 2) {
    // "mos mub" — a first-name prefix and a last-name prefix.
    builder = builder
      .ilike("first_name", `${escape(parts[0])}%`)
      .ilike("last_name", `${escape(parts[1])}%`);
  } else {
    builder = builder.or(
      `first_name.ilike.${escape(parts[0])}%,last_name.ilike.${escape(parts[0])}%`,
    );
  }

  // One more than the cap, purely to know whether to say "narrow it down".
  const { data } = await builder
    .order("last_name", { ascending: true })
    .limit(MAX_SEARCH_RESULTS + 1);

  const rows = (data ?? []) as Record<string, unknown>[];
  const truncated = rows.length > MAX_SEARCH_RESULTS;
  const visible = rows.slice(0, MAX_SEARCH_RESULTS);

  if (visible.length === 0) return { people: [], truncated: false };

  const { data: facts } = await admin
    .from("attendance_facts")
    .select("member_id, status")
    .eq("service_occurrence_id", input.session.occurrenceId)
    .eq("church_id", input.session.churchId)
    .in("member_id", visible.map((row) => row.id as string));

  const counted = new Set(
    ((facts ?? []) as Record<string, unknown>[])
      .filter((row) => row.status === "active")
      .map((row) => row.member_id as string),
  );

  return {
    truncated,
    people: visible.map((row) => ({
      memberId: row.id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      alreadyCounted: counted.has(row.id as string),
    })),
  };
}

// ---------------------------------------------------------------------------
// The check-in
// ---------------------------------------------------------------------------

/**
 * Checks one person in, through the one attendance command.
 *
 * **There is no kiosk insert path.** `record_attendance` validates the window,
 * the tenancy and the policy exactly as it does for a phone or the dashboard,
 * and produces the same audited attempt and the same unique counted fact. A
 * kiosk is a caller of the attendance authority, not a second one.
 *
 * `actorType` is `kiosk` rather than `staff`: the report should be able to say
 * "the welcome desk counted this" without implying a named staff member stood
 * over it, and the kiosk holds no user id to name.
 */
export async function kioskCheckIn(input: {
  session: KioskSession;
  memberId: string;
  idempotencyKey: string;
  client?: SupabaseClient;
}): Promise<AttendanceResult> {
  return recordAttendance(
    {
      // From the session. A request naming an occurrence would be a request to
      // check into a different service, so no request may name one.
      occurrenceId: input.session.occurrenceId,
      memberId: input.memberId,
      source: "kiosk",
      actorType: "kiosk",
      idempotencyKey: input.idempotencyKey,
    },
    input.client,
  );
}

/** Seven characters from the alphabet with every confusable pair removed. */
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
