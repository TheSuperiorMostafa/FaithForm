import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens.
 *
 * The raw token is returned exactly once, to the staff member who created it,
 * and is never stored. What the database holds is a SHA-256 hash, so a leaked
 * backup does not yield working invitation links.
 *
 * SHA-256 rather than a password hash is the right choice here: the token is
 * 256 bits of CSPRNG output, so there is no dictionary to attack and no reason
 * to pay the cost of a slow KDF on every redemption.
 */
const TOKEN_BYTES = 32;

export function generateInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison for the rare path that compares two hashes in
 * application code. The database lookup is by hash equality on an indexed
 * unique column, which is the normal path.
 */
export function invitationHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function invitationExpiry(days: number, now = new Date()): Date {
  const expires = new Date(now);
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
}

/**
 * A token is only ever shown as part of a link. Kept here so no caller has to
 * remember that the token belongs in the fragment-free path segment and never
 * in a query string that ends up in server logs or a Referer header.
 */
export function buildInvitationPath(token: string): string {
  return `/faithful/invite/${encodeURIComponent(token)}`;
}
