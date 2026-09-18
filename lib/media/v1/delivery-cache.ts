import { ExpiringCache } from "@/lib/cache/expiring-cache";

export { ExpiringCache };

/**
 * A short-lived memory of "this viewer may watch this" for the live delivery
 * route.
 *
 * ## Why it exists
 *
 * A live player asks for a playlist and a segment every second or two, and the
 * route used to re-run the whole authorization — account, relationship,
 * publication — against the database on every one of them. In production that
 * cost 0.6–1.7s per request, before the relay was even asked. The relay keeps a
 * live segment for only a few seconds, so by the time a segment request arrived
 * the segment had already been deleted: the playlist loaded, every segment
 * 404ed, and the apps sat on "Connecting" with one frozen frame.
 *
 * ## What it gives up, and why that is acceptable
 *
 * A positive answer is reused for [DELIVERY_AUTHORIZATION_TTL_MS] per server
 * instance, so an unpublish or a revocation stops a stream within about fifteen
 * seconds instead of within one segment. Nothing else changes: every request is
 * still signature-checked, the cache is keyed by account, church, item and the
 * authorization version the token was minted under (so a sign-out still
 * invalidates at once), and a refusal is never cached.
 */
export const DELIVERY_AUTHORIZATION_TTL_MS = 15_000;

/**
 * Runs [authorize] only when no recent positive answer exists for [key].
 *
 * Null — a refusal — is returned as is and never remembered, so a viewer who
 * was just granted access is not kept out by an earlier "no", and a transient
 * database failure is retried on the next request.
 */
export async function withCachedAuthorization<T>(
  cache: ExpiringCache<T>,
  key: string,
  authorize: () => Promise<T | null>,
): Promise<T | null> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const value = await authorize();
  if (value !== null) cache.set(key, value);
  return value;
}
