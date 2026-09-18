import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The playback capability a FaithForm app presents to watch something.
 *
 * ## Why this is not `lib/stream/playback.ts`
 *
 * That module is Prompt 2's, it works, and it stays. But its capability is
 * bound to a church, an event and an *audience* — `public` or `staff` — and to
 * nothing else. It has no idea who is holding it, because the website's player
 * has no idea either: a visitor watching a livestream on a church's site is not
 * signed in.
 *
 * FaithForm's visitors **are** signed in, their access depends on a relationship
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
 *     subKey = HMAC(secret, "faithform.faithform.media.v1|" + type)
 *
 * A FaithForm capability therefore cannot verify as a website `cap`, and a
 * website `cap` — which is not account-scoped — cannot be replayed against a
 * FaithForm route. Reusing the existing secret is deliberate: it introduces no
 * new deployment variable, and the derivation is what makes the two
 * non-interchangeable rather than the storage location.
 *
 * ## Where it lives, and where it does not
 *
 * It travels in an `Authorization: Bearer` header and **never in a URL**: a
 * capability in a query string is a capability in a browser history, a proxy
 * log, a referrer, and a screenshot of a share sheet.
 *
 * ## The delivery token, which does live in a URL
 *
 * A native HLS player cannot carry a header on every request. AVFoundation
 * refuses media segments served through an `AVAssetResourceLoaderDelegate`
 * (CoreMediaErrorDomain -12881, "custom url not redirect") and accepts only a
 * redirect to a plain HTTP URL, which drops any header; the only other way to
 * attach one, `AVURLAssetHTTPHeaderFieldsKey`, is undocumented. So a live
 * stream is addressed by a URL that carries a **delivery token** in its path:
 *
 *   * a different type, signed under its own sub-key and format prefix, so a
 *     delivery token never verifies as a capability or the reverse;
 *   * bound to the same account, church, kind, item and authorization version;
 *   * valid for one viewing session rather than five minutes, because HLS
 *     forbids a listed segment's URL from changing (RFC 8216 §6.2.2) and every
 *     segment URL inherits the token from the playlist URL;
 *   * worth nothing on its own: the delivery route re-runs the full
 *     authorization on **every** playlist and segment request, so an unpublish,
 *     a revocation, an ended service or a sign-out refuses the next request no
 *     matter what the token's expiry says.
 *
 * It sits in the path, never a query string, and the account capability still
 * never enters a URL.
 *
 * Nothing in this file logs.
 */

const DOMAIN = "faithform.faithform.media.v1";
const FORMAT = "FFM1";
const DELIVERY_FORMAT = "FFD1";

export const MEDIA_CAPABILITY_TYPES = ["playback", "delivery"] as const;
export type MediaCapabilityType = (typeof MEDIA_CAPABILITY_TYPES)[number];

export type MediaKind = "live" | "recording";

/**
 * Five minutes.
 *
 * Short enough that a revoked visitor loses access within one refresh, long
 * enough that a phone is not renewing constantly on a train. Deliberately
 * **not** quantized the way the website capability is: that quantization exists
 * so a five-second status poll does not rewrite the player URL, and FaithForm
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

/**
 * How long a delivery token addresses a stream: six hours.
 *
 * Long because it has to be. It is part of every playlist and segment URL the
 * player derives from the one it was handed, and HLS does not allow those to
 * change mid-stream, so it must outlast a service rather than be renewed
 * inside one. The expiry bounds only how long a URL stays *well-formed*;
 * whether it may still be used is decided per request by the delivery route.
 */
export const MEDIA_DELIVERY_TTL_SECONDS = 6 * 60 * 60;

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

  return mint(material, FORMAT, {
    v: 1,
    t: "playback",
    a: input.accountId,
    c: input.churchSlug,
    k: input.kind,
    m: input.mediaId,
    av: input.authorizationVersion,
    e: now + ttl,
  });
}

/**
 * Issues the token a live stream's delivery URL carries in its path.
 *
 * See "The delivery token" above. Minted beside a capability, from the same
 * grant decision, and never instead of the per-request authorization.
 */
export function issueMediaDeliveryToken(input: {
  accountId: string;
  churchSlug: string;
  kind: MediaKind;
  mediaId: string;
  authorizationVersion: number;
  nowSeconds?: number;
}): { token: string; expiresAt: string } | null {
  const material = secret();
  if (!material) return null;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  return mint(material, DELIVERY_FORMAT, {
    v: 1,
    t: "delivery",
    a: input.accountId,
    c: input.churchSlug,
    k: input.kind,
    m: input.mediaId,
    av: input.authorizationVersion,
    e: now + MEDIA_DELIVERY_TTL_SECONDS,
  });
}

/**
 * Whether a path segment is shaped like a delivery token.
 *
 * Shape only — it proves nothing. The route uses it to tell a delivery path
 * from a header-authenticated one, then verifies the token like any other.
 */
export function isMediaDeliveryToken(segment: string | null | undefined): boolean {
  return typeof segment === "string" && segment.startsWith(`${DELIVERY_FORMAT}.`);
}

function mint(
  material: string,
  format: string,
  payload: MediaCapability,
): { token: string; expiresAt: string } | null {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `${format}.${body}`;
  const token = `${signed}.${sign(payload.t, material, signed)}`;
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
  expected?: VerificationExpectations,
): CapabilityVerification {
  return verifySigned("playback", FORMAT, token, expected);
}

/**
 * Verifies a delivery token taken from a delivery path.
 *
 * The same order and the same refusals as a capability, under the delivery
 * sub-key and prefix — so a capability presented here, or a delivery token
 * presented as a bearer header, fails its signature.
 */
export function verifyMediaDeliveryToken(
  token: string | null | undefined,
  expected?: VerificationExpectations,
): CapabilityVerification {
  return verifySigned("delivery", DELIVERY_FORMAT, token, expected);
}

type VerificationExpectations = {
  accountId?: string;
  churchSlug?: string;
  kind?: MediaKind;
  mediaId?: string;
  authorizationVersion?: number;
  nowSeconds?: number;
};

function verifySigned(
  type: MediaCapabilityType,
  expectedFormat: string,
  token: string | null | undefined,
  expected?: VerificationExpectations,
): CapabilityVerification {
  const material = secret();
  if (!material) return { ok: false, reason: "unconfigured" };

  if (typeof token !== "string" || !token || token.length > MAX_CAPABILITY_LENGTH) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [format, body, signature] = parts;
  if (format !== expectedFormat || !body || !signature) {
    return { ok: false, reason: "malformed" };
  }

  const expectedSignature = Buffer.from(
    sign(type, material, `${format}.${body}`),
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
    capability.t !== type ||
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
