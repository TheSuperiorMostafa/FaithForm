import { createHmac, timingSafeEqual } from "node:crypto";

import { compareSecret } from "@/lib/security/compare-secret";

/**
 * Authenticating the stream relay.
 *
 * The relay is FaithForm's video provider, so its callbacks are part of the
 * security boundary: they create recordings, move them through their lifecycle
 * and are handed upload URLs into private storage. Each request is therefore:
 *
 *   * **signed** — `HMAC-SHA256(secret, "v1:" + timestamp + ":" + nonce + ":" + body)`,
 *     so a captured request cannot be altered, and the secret itself never
 *     crosses the wire (the legacy scheme sent it in a header on every call);
 *   * **fresh** — the timestamp must be within five minutes of now;
 *   * **single-use** — the nonce is recorded, and a second request carrying it
 *     is refused, so a captured request cannot be replayed inside the window.
 *
 * Idempotency is a separate concern and lives in the handlers: a *retry* is a
 * new request with a new nonce, and converges because every relay operation is
 * keyed by take id and sequence number.
 *
 * The legacy header (`x-stream-relay-secret`) is still accepted on the routes
 * that existed before this scheme, so a relay that has not been redeployed
 * keeps working. The recording routes introduced alongside it accept only
 * signatures.
 *
 * Nothing here logs a header, a body or a secret.
 */

export const RELAY_SIGNATURE_HEADER = "x-faithform-relay-signature";
export const RELAY_TIMESTAMP_HEADER = "x-faithform-relay-timestamp";
export const RELAY_NONCE_HEADER = "x-faithform-relay-nonce";
export const LEGACY_RELAY_SECRET_HEADER = "x-stream-relay-secret";

/** How far a relay's clock may drift from ours. */
export const RELAY_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/** The largest body any relay route accepts. A prepare batch is a few KB. */
export const MAX_RELAY_BODY_BYTES = 64 * 1024;

const NONCE = /^[A-Za-z0-9_-]{16,80}$/;

/**
 * The shared relay secret, exactly as the legacy routes compared it. Not
 * length-checked here: the deployed value predates this module, and refusing a
 * shorter one would take the relay offline rather than make anything safer.
 */
function relaySecret(): string | null {
  const value = process.env.STREAM_RELAY_WEBHOOK_SECRET;
  if (!value || value.startsWith("replace-me")) return null;
  return value;
}

export function signRelayPayload(input: {
  secret: string;
  timestamp: number;
  nonce: string;
  body: string;
}): string {
  const mac = createHmac("sha256", input.secret)
    .update(`v1:${input.timestamp}:${input.nonce}:${input.body}`, "utf8")
    .digest("hex");
  return `v1=${mac}`;
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "bad_signature" };

/** Pure verification. The nonce ledger is checked by the caller. */
export function verifyRelaySignature(input: {
  secret: string;
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  body: string;
  nowSeconds?: number;
}): SignatureCheck {
  if (!input.signature || !input.timestamp || !input.nonce) return { ok: false, reason: "missing" };
  if (!/^\d{9,11}$/.test(input.timestamp) || !NONCE.test(input.nonce)) {
    return { ok: false, reason: "malformed" };
  }
  const match = /^v1=([0-9a-f]{64})$/.exec(input.signature.trim());
  if (!match) return { ok: false, reason: "malformed" };

  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > RELAY_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected = Buffer.from(
    signRelayPayload({ secret: input.secret, timestamp, nonce: input.nonce, body: input.body }).slice(3),
    "hex",
  );
  const actual = Buffer.from(match[1], "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

/** Records a nonce; false when it has been seen before. */
export type NonceLedger = (input: { nonce: string; route: string }) => Promise<boolean>;

export type RelayAuthentication =
  | { ok: true; rawBody: string; json: unknown; signed: boolean }
  | { ok: false; status: 400 | 401 | 409 | 413 | 503; error: string };

/**
 * Reads, bounds, authenticates and parses a relay request.
 *
 * Order matters: the body is read (bounded) and the signature proved before a
 * byte of it is parsed, and the nonce is only spent once the signature holds —
 * so an unauthenticated caller cannot burn nonces or reach `JSON.parse`.
 */
export async function authenticateRelayRequest(
  request: Request,
  options: {
    route: string;
    allowLegacySecret: boolean;
    ledger: NonceLedger;
    nowSeconds?: number;
  },
): Promise<RelayAuthentication> {
  const secret = relaySecret();
  if (!secret) return { ok: false, status: 503, error: "Relay callbacks are not configured." };

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RELAY_BODY_BYTES) {
    return { ok: false, status: 413, error: "Payload too large." };
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return { ok: false, status: 400, error: "Unreadable body." };
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_RELAY_BODY_BYTES) {
    return { ok: false, status: 413, error: "Payload too large." };
  }

  const signature = request.headers.get(RELAY_SIGNATURE_HEADER);
  let signed = false;

  if (signature) {
    const nonce = request.headers.get(RELAY_NONCE_HEADER);
    const check = verifyRelaySignature({
      secret,
      signature,
      timestamp: request.headers.get(RELAY_TIMESTAMP_HEADER),
      nonce,
      body: rawBody,
      nowSeconds: options.nowSeconds,
    });
    if (!check.ok) return { ok: false, status: 401, error: "Unauthorized" };

    const fresh = await options.ledger({ nonce: nonce as string, route: options.route });
    if (!fresh) return { ok: false, status: 409, error: "Replayed request." };
    signed = true;
  } else if (options.allowLegacySecret) {
    if (!compareSecret(request.headers.get(LEGACY_RELAY_SECRET_HEADER), secret)) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
  } else {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  let json: unknown = null;
  if (rawBody.length > 0) {
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { ok: false, status: 400, error: "Invalid JSON" };
    }
  }
  return { ok: true, rawBody, json, signed };
}
