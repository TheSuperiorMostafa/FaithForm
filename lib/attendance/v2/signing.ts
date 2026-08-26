import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The signing authority behind every Faithful check-in capability.
 *
 * Prompt 6 signed QR codes with `ATTENDANCE_QR_SECRET` directly: one key, one
 * format, no key identifier, and no separation between what a signature was
 * minted for and what it might be accepted as. That was adequate while a QR
 * capability was the only signed thing in the system. It is not adequate now
 * that a display capability, a pairing code, and a kiosk credential all exist,
 * because a signature that means nothing in particular means everything.
 *
 * Three properties this establishes.
 *
 * **Domain separation.** No capability is ever signed with the master key.
 * Every type derives its own sub-key:
 *
 *     subKey(type) = HMAC(master, "faithform.faithful.attendance.v1|" + type)
 *
 * A token minted as a display capability therefore cannot verify as a check-in
 * token even if an attacker rewrote its body, because the two were signed under
 * keys that are computationally unrelated. The issuer and audience are bound the
 * same way — they are inside the derivation string, so a token from another
 * deployment or another product never verifies here. That is stronger than
 * carrying `iss` and `aud` as claims and checking them, and it costs no bytes on
 * a code someone has to scan across a sanctuary. The type is *also* carried in
 * the body and checked explicitly, so a token remains self-describing to anyone
 * debugging one.
 *
 * **Key versions with a rotation grace.** `ATTENDANCE_QR_SECRET` mints and
 * verifies; `ATTENDANCE_QR_SECRET_PREVIOUS` only ever verifies. A token names
 * its key by a fingerprint derived *from* the key, which reveals nothing about
 * it. So an operator rotates by moving the current value into the previous slot,
 * installing a new one, and removing the old slot once the longest-lived
 * capability has expired — with nothing invalidated mid-service.
 *
 * **Fail closed.** A missing, short, or placeholder key does not fall back to a
 * default, a constant, or an unsigned mode. Minting returns `null` and
 * verification refuses. A deployment with no key configured has no QR check-in,
 * which is the correct behaviour and is visible rather than silent — see
 * `checkinSigningStatus`.
 *
 * **Nothing here is ever logged.** No function in this file writes to the
 * console. Callers must not log a token, a code, a pairing code, or a
 * credential; `tests/security/checkin-privacy.test.ts` sweeps for it.
 */

const DOMAIN = "faithform.faithful.attendance.v1";

/** Every distinct purpose a key may be used for. Each gets its own sub-key. */
export const CAPABILITY_TYPES = [
  "checkin.qr",
  "checkin.display",
  "checkin.pairing",
  "kiosk.pairing",
  "kiosk.credential",
  "shortcode",
] as const;

export type CapabilityType = (typeof CAPABILITY_TYPES)[number];

/** Guards against a pathological body before any parsing happens. */
export const MAX_TOKEN_LENGTH = 1024;

const FORMAT = "FF1";
const MIN_KEY_LENGTH = 32;

type SigningKey = {
  /** A fingerprint *of* the key. Derived, so it discloses nothing. */
  id: string;
  material: string;
  /** Only the current key may mint. A previous key verifies and nothing else. */
  mintable: boolean;
};

function usableSecret(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // The same three refusals Prompt 6 established: absent, too short to be a
  // key, or the placeholder someone forgot to replace.
  if (trimmed.length < MIN_KEY_LENGTH) return null;
  if (trimmed.startsWith("replace-me")) return null;
  return trimmed;
}

function fingerprint(material: string): string {
  return createHmac("sha256", material)
    .update(`${DOMAIN}|key-id`)
    .digest("base64url")
    .slice(0, 10);
}

/**
 * The keys this process may use, current first.
 *
 * Read on every call rather than cached at module load: a test that installs a
 * key after import, and a deployment that rotates without a restart, both
 * behave the way someone would expect.
 */
function keyRing(): SigningKey[] {
  const ring: SigningKey[] = [];

  const current = usableSecret(process.env.ATTENDANCE_QR_SECRET);
  if (current) {
    ring.push({ id: fingerprint(current), material: current, mintable: true });
  }

  const previous = usableSecret(process.env.ATTENDANCE_QR_SECRET_PREVIOUS);
  // A previous slot that still holds the current value is not a rotation and
  // must not double the ring — it would just mean two identical entries.
  if (previous && previous !== current) {
    ring.push({ id: fingerprint(previous), material: previous, mintable: false });
  }

  return ring;
}

function mintingKey(): SigningKey | null {
  return keyRing().find((key) => key.mintable) ?? null;
}

/**
 * Whether signing is configured, and under how many keys.
 *
 * Deliberately returns fingerprints rather than a boolean alone, so an operator
 * can confirm a rotation took effect without any way to recover a key. Safe to
 * surface in an admin diagnostic; still never safe to log alongside a token.
 */
export function checkinSigningStatus(): {
  configured: boolean;
  activeKeyId: string | null;
  acceptedKeyIds: string[];
  inRotation: boolean;
} {
  const ring = keyRing();
  return {
    configured: ring.some((key) => key.mintable),
    activeKeyId: ring.find((key) => key.mintable)?.id ?? null,
    acceptedKeyIds: ring.map((key) => key.id),
    inRotation: ring.length > 1,
  };
}

function subKey(type: CapabilityType, material: string): Buffer {
  return createHmac("sha256", material).update(`${DOMAIN}|${type}`).digest();
}

function sign(type: CapabilityType, material: string, body: string): string {
  return createHmac("sha256", subKey(type, material)).update(body).digest("base64url");
}

// ---------------------------------------------------------------------------
// Compact identifiers
// ---------------------------------------------------------------------------

/**
 * A uuid as 22 base64url characters rather than 36.
 *
 * Fourteen characters saved twice over is the difference between a QR a person
 * scans from the third row and one they have to walk up to: payload size drives
 * module count, and module count drives the distance at which a phone camera
 * resolves it.
 */
export function packUuid(value: string): string | null {
  const hex = value.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return Buffer.from(hex, "hex").toString("base64url");
}

export function unpackUuid(value: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64url");
  } catch {
    return null;
  }
  if (bytes.length !== 16) return null;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type CapabilityBody = Record<string, unknown> & { t: CapabilityType };

/**
 * Mints a capability. `null` when no key may mint, never an unsigned token.
 */
export function mintCapability(
  type: CapabilityType,
  body: Omit<CapabilityBody, "t">,
): string | null {
  const key = mintingKey();
  if (!key) return null;

  const payload = Buffer.from(JSON.stringify({ ...body, t: type }), "utf8")
    .toString("base64url");
  const signed = `${FORMAT}.${key.id}.${payload}`;
  const token = `${signed}.${sign(type, key.material, signed)}`;

  // A token longer than the guard would be refused on the way back in, so
  // refusing to mint it is the honest failure rather than a code nobody can
  // redeem.
  return token.length > MAX_TOKEN_LENGTH ? null : token;
}

export type CapabilityVerification<T> =
  | { ok: true; body: T; keyId: string }
  | { ok: false; reason: "unconfigured" | "malformed" | "unknown_key" | "bad_signature" | "wrong_type" };

/**
 * Verifies a capability against every key in the ring, in order.
 *
 * The order of checks matters and is deliberate: shape, then key, then
 * signature, then contents. Nothing inside the payload is read until the
 * signature over it has been proven, so a hostile body never reaches `JSON.parse`
 * on the strength of its own claims.
 */
export function verifyCapability<T = CapabilityBody>(
  type: CapabilityType,
  token: string | null | undefined,
): CapabilityVerification<T> {
  const ring = keyRing();
  if (ring.length === 0) return { ok: false, reason: "unconfigured" };

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };

  const [format, keyId, payload, signature] = parts;
  if (format !== FORMAT || !keyId || !payload || !signature) {
    return { ok: false, reason: "malformed" };
  }

  const key = ring.find((candidate) => candidate.id === keyId);
  // An unknown fingerprint means a key this deployment has rotated past, or one
  // it never had. Either way there is nothing to compare against.
  if (!key) return { ok: false, reason: "unknown_key" };

  const expected = Buffer.from(sign(type, key.material, `${format}.${keyId}.${payload}`), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let body: CapabilityBody;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!body || typeof body !== "object") return { ok: false, reason: "malformed" };
  // Belt to the sub-key's braces. The derivation already makes cross-type
  // verification impossible; this makes a mismatch legible rather than
  // mysterious.
  if (body.t !== type) return { ok: false, reason: "wrong_type" };

  return { ok: true, body: body as unknown as T, keyId: key.id };
}

// ---------------------------------------------------------------------------
// Keyed hashes for things a person types
// ---------------------------------------------------------------------------

/**
 * The hash stored for a short code, a pairing code, or a kiosk credential.
 *
 * **Keyed, not plain.** A six-character short code carries about 27 bits; a
 * plain SHA-256 table of them is exhaustible on a laptop in seconds, so a
 * database copy would yield every live code. An HMAC under a key that is not in
 * the database does not, and that is the entire point of the distinction.
 *
 * Returns `null` when nothing may mint, so a caller cannot accidentally store a
 * hash computed under a key that does not exist.
 */
export function keyedHash(type: CapabilityType, value: string): string | null {
  const key = mintingKey();
  if (!key) return null;
  return createHmac("sha256", subKey(type, key.material)).update(value, "utf8").digest("hex");
}

/**
 * Every hash a stored value could have, current key first.
 *
 * A lookup tries these in order, so a code hashed before a rotation still
 * resolves during the grace period. One probe in the ordinary case, two while a
 * rotation is in flight — and once the previous slot is removed, the old hashes
 * stop resolving, which is what ends the grace.
 */
export function keyedHashCandidates(type: CapabilityType, value: string): string[] {
  return keyRing().map((key) =>
    createHmac("sha256", subKey(type, key.material)).update(value, "utf8").digest("hex"),
  );
}

/** A long random value: a kiosk credential, or a nonce with no derivation. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * A value derived from the key and a label, rather than drawn at random.
 *
 * Used where two independent callers must agree without coordinating — both
 * pollers of a display compute the same rotation nonce because both compute
 * this, not because either stored it.
 */
export function derivedValue(
  type: CapabilityType,
  label: string,
  lengthInBytes = 12,
): string | null {
  const key = mintingKey();
  if (!key) return null;
  return createHmac("sha256", subKey(type, key.material))
    .update(label, "utf8")
    .digest()
    .subarray(0, lengthInBytes)
    .toString("base64url");
}
