import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The playback capability a Faithful app presents to watch something.
 *
 * ## Why this is not `lib/stream/playback.ts`
 *
 * That module is Prompt 2's, it works, and it stays. But its capability is
 * bound to a church, an event and an *audience* — `public` or `staff` — and to
 * nothing else. It has no idea who is holding it, because the website's player
 * has no idea either: a visitor watching a livestream on a church's site is not
 * signed in.
 *
 * Faithful's visitors **are** signed in, their access depends on a relationship
 * a church can revoke, and what they may watch depends on a publication
 * decision a pastor makes. So this capability names:
 *
 *   * the **account** — a token minted for one visitor is refused for another;
 *   * the **church**, by slug;
 *   * the **media item**, and its kind, so a live capability cannot fetch a
 *     recording or the reverse;
 *   * the **authorization version** the account held when it was issued, so
 *     any event that bumps that version invalidates every capability in flight.
 *
 * ## Domain separation from the web capability
 *
 * Both are signed with `STREAM_PLAYBACK_SECRET`, but never with the raw secret:
 *
 *     subKey = HMAC(secret, "faithform.faithful.media.v1|" + type)
 *
 * A Faithful capability therefore cannot verify as a website `cap`, and a
 * website `cap` — which is not account-scoped — cannot be replayed against a
 * Faithful route. Reusing the existing secret is deliberate: it introduces no
 * new deployment variable, and the derivation is what makes the two
 * non-interchangeable rather than the storage location.
 *
 * ## Where it lives, and where it does not
 *
 * It travels in an `Authorization: Bearer` header and **never in a URL**. That
 * is the whole reason both native players are wired through header-capable
 * loaders: a capability in a query string is a capability in a browser history,
 * a proxy log, a referrer, and a screenshot of a share sheet.
 *
 * Nothing in this file logs.
 */

const DOMAIN = "faithform.faithful.media.v1";
const FORMAT = "FFM1";

export const MEDIA_CAPABILITY_TYPES = ["playback"] as const;
export type MediaCapabilityType = (typeof MEDIA_CAPABILITY_TYPES)[number];

export type MediaKind = "live" | "recording";

/**
 * Five minutes.
 *
 * Short enough that a revoked visitor loses access within one refresh, long
 * enough that a phone is not renewing constantly on a train. Deliberately
 * **not** quantized the way the website capability is: that quantization exists
 * so a five-second status poll does not rewrite the player URL, and Faithful
 * refreshes on an explicit schedule instead.
 */
export const MEDIA_CAPABILITY_TTL_SECONDS = 5 * 60;

/**
 * How early a client should refresh.
 *
 * A capability that expires mid-segment produces a stall the person sees. Sixty
 * seconds of headroom means a refresh has a whole minute to complete, retry
 * once, and still land before the current one dies.
 */
export const MEDIA_CAPABILITY_REFRESH_LEAD_SECONDS = 60;

export const MAX_CAPABILITY_LENGTH = 1024;

export type MediaCapability = {
  /** Format version. */
  v: 1;
  t: MediaCapabilityType;
  /** Visitor account id. */
  a: string;
  /** Church slug. */
  c: string;
  k: MediaKind;
  /** Media item id. */
  m: string;
  /** The account's authorization version at issuance. */
  av: number;
  /** Expiry, epoch seconds. */
  e: number;
};

function secret(): string | null {
  const value = process.env.STREAM_PLAYBACK_SECRET?.trim();
  // The same three refusals the rest of the codebase uses: absent, too short to
  // be a key, or the placeholder someone forgot to replace.
  if (!value || value.length < 32 || value.startsWith("replace-me")) return null;
  return value;
}

function subKey(type: MediaCapabilityType, material: string): Buffer {
  return createHmac("sha256", material).update(`${DOMAIN}|${type}`).digest();
}

function sign(type: MediaCapabilityType, material: string, body: string): string {
  return createHmac("sha256", subKey(type, material)).update(body).digest("base64url");
}

/** Whether playback signing is configured at all. Never returns the key. */
export function mediaPlaybackConfigured(): boolean {
  return secret() !== null;
}

export function issueMediaCapability(input: {
  accountId: string;
  churchSlug: string;
  kind: MediaKind;
  mediaId: string;
  authorizationVersion: number;
  nowSeconds?: number;
  ttlSeconds?: number;
}): { token: string; expiresAt: string } | null {
  const material = secret();
  if (!material) return null;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(
    MEDIA_CAPABILITY_TTL_SECONDS,
    Math.max(30, input.ttlSeconds ?? MEDIA_CAPABILITY_TTL_SECONDS),
  );

  const payload: MediaCapability = {
    v: 1,
    t: "playback",
    a: input.accountId,
    c: input.churchSlug,
    k: input.kind,
    m: input.mediaId,
    av: input.authorizationVersion,
    e: now + ttl,
  };

  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `${FORMAT}.${body}`;
  const token = `${signed}.${sign("playback", material, signed)}`;
  if (token.length > MAX_CAPABILITY_LENGTH) return null;

  return { token, expiresAt: new Date(payload.e * 1000).toISOString() };
}

export type CapabilityVerification =
  | { ok: true; capability: MediaCapability }
  | { ok: false; reason: "unconfigured" | "malformed" | "bad_signature" | "expired" | "mismatch" };

/**
 * Verifies a presented capability.
 *
 * Order matters and is deliberate: shape, then signature, then contents. Nothing
 * inside the payload is read until the signature over it has been proven, so a
 * hostile body never reaches `JSON.parse` on the strength of its own claims.
 *
 * `expected` narrows further. A capability for the right account but the wrong
 * media item, or the right item in the wrong church, is a `mismatch` — which is
 * how a cross-church and cross-account replay is refused even though the
 * signature is genuinely ours.
 */
export function verifyMediaCapability(
  token: string | null | undefined,
  expected?: {
    accountId?: string;
    churchSlug?: string;
    kind?: MediaKind;
    mediaId?: string;
    authorizationVersion?: number;
    nowSeconds?: number;
  },
): CapabilityVerification {
  const material = secret();
  if (!material) return { ok: false, reason: "unconfigured" };

  if (typeof token !== "string" || !token || token.length > MAX_CAPABILITY_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [format, body, signature] = parts;
  if (format !== FORMAT || !body || !signature) return { ok: false, reason: "malformed" };

  const expectedSignature = Buffer.from(
    sign("playback", material, `${format}.${body}`),
    "utf8",
  );
  const actual = Buffer.from(signature, "utf8");
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) {
    return { ok: false, reason: "bad_signature" };
  }

  let capability: MediaCapability;
  try {
    capability = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    !capability ||
    capability.v !== 1 ||
    capability.t !== "playback" ||
    typeof capability.a !== "string" ||
    typeof capability.c !== "string" ||
    typeof capability.m !== "string" ||
    typeof capability.av !== "number" ||
    typeof capability.e !== "number" ||
    (capability.k !== "live" && capability.k !== "recording")
  ) {
    return { ok: false, reason: "malformed" };
  }

  const now = expected?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (capability.e <= now) return { ok: false, reason: "expired" };

  if (
    (expected?.accountId && capability.a !== expected.accountId) ||
    (expected?.churchSlug && capability.c !== expected.churchSlug) ||
    (expected?.kind && capability.k !== expected.kind) ||
    (expected?.mediaId && capability.m !== expected.mediaId) ||
    (expected?.authorizationVersion !== undefined &&
      capability.av !== expected.authorizationVersion)
  ) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true, capability };
}

/**
 * Reads a capability from an `Authorization: Bearer` header.
 *
 * The only supported location. There is no query-string fallback here on
 * purpose — adding one would put the capability back into URLs, which is the
 * thing the native players were wired around.
 */
export function capabilityFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value.trim() || null;
}
