import { createHash, timingSafeEqual } from "node:crypto";

import { MobileError } from "@/lib/mobile/v1/errors";

/**
 * Cursors, ETags, and idempotency keys.
 *
 * All three are opaque to the client by design. A cursor is not a page number
 * and not a row offset; an ETag is not a timestamp. Keeping them opaque is what
 * lets the server change how a list is ordered without breaking a released app.
 */

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;

/** Refuse bodies large enough to be an attack rather than a mistake. */
export const MAX_REQUEST_BYTES = 16 * 1024;

export type Cursor = { k: string; v: string[] };

/**
 * Base64url JSON. Versioned by `k` (the keyset it belongs to) so a cursor
 * minted for one list cannot be replayed against another — the decoder checks
 * the kind and rejects a mismatch rather than silently paging from nonsense.
 */
export function encodeCursor(kind: string, values: string[]): string {
  const payload: Cursor = { k: kind, v: values };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(
  raw: string | null | undefined,
  expectedKind: string,
): string[] | null {
  if (!raw) return null;
  if (raw.length > 512) throw new MobileError("invalid_cursor", "Invalid cursor.");

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as Partial<Cursor>;

    if (
      parsed.k !== expectedKind ||
      !Array.isArray(parsed.v) ||
      parsed.v.some((value) => typeof value !== "string") ||
      parsed.v.length > 4
    ) {
      throw new MobileError("invalid_cursor", "Invalid cursor.");
    }
    return parsed.v as string[];
  } catch (error) {
    if (error instanceof MobileError) throw error;
    throw new MobileError("invalid_cursor", "Invalid cursor.");
  }
}

export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_PAGE_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_LIMIT) {
    throw new MobileError(
      "invalid_request",
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`,
      { fields: [{ field: "limit", issue: "out_of_range" }] },
    );
  }
  return parsed;
}

/**
 * A strong ETag over the response's semantic content.
 *
 * Derived from the payload rather than a row timestamp, so two servers with
 * clock skew agree, and so an unchanged payload keeps its tag across a deploy.
 */
export function computeEtag(payload: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("base64url");
  return `"${digest.slice(0, 32)}"`;
}

/**
 * Handles `If-None-Match`, including the `*` and multi-value forms. Comparison
 * is constant-time to avoid making the tag a probing oracle.
 */
export function etagMatches(
  ifNoneMatch: string | null | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false;
  const candidates = ifNoneMatch.split(",").map((value) => value.trim());
  if (candidates.includes("*")) return true;

  const expected = Buffer.from(etag, "utf8");
  return candidates.some((candidate) => {
    // A weak validator still identifies the same semantic payload.
    const normalized = candidate.startsWith("W/") ? candidate.slice(2) : candidate;
    const actual = Buffer.from(normalized, "utf8");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  });
}

/**
 * Idempotency keys for retryable commands.
 *
 * The client mints one per logical intent and reuses it across retries, so a
 * request that succeeded but whose response was lost does not create a second
 * effect when the phone tries again.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!key) {
    throw new MobileError(
      "missing_idempotency_key",
      `${IDEMPOTENCY_HEADER} is required for this operation.`,
    );
  }
  if (key.length < 8 || key.length > 120 || !/^[A-Za-z0-9._~-]+$/.test(key)) {
    throw new MobileError(
      "invalid_request",
      `${IDEMPOTENCY_HEADER} must be 8–120 URL-safe characters.`,
      { fields: [{ field: "Idempotency-Key", issue: "malformed" }] },
    );
  }
  return key;
}

/**
 * Reads and size-limits a JSON body.
 *
 * The length check happens before parsing so an oversized body is rejected
 * without being materialized.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_REQUEST_BYTES) {
    throw new MobileError("payload_too_large", "Request body is too large.");
  }

  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) {
    throw new MobileError("payload_too_large", "Request body is too large.");
  }
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new MobileError("invalid_request", "Body must be valid JSON.");
  }
}

/**
 * The client build, used to enforce a minimum supported version.
 * Absent or unparseable is treated as "unknown", not as "too old" — an older
 * client that never learned to send it must still be able to sign in and
 * receive the upgrade instruction.
 */
export function parseClientBuild(request: Request): number | null {
  const raw = request.headers.get("X-FaithForm-Client-Build");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
