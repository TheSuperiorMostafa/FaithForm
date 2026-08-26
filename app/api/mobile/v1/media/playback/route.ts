import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { playbackGrantRequestSchema } from "@/lib/mobile/v1/contract";
import { grantPlayback } from "@/lib/media/v1/media-service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getVisitorAccount } from "@/lib/faithful/account";

export const dynamic = "force-dynamic";

/**
 * Acquires or refreshes a playback capability.
 *
 * **Authenticated, unlike the list and detail routes.** Browsing a church's
 * public sermons signed out is the same exposure its website already has;
 * *watching* through Faithful mints a capability that must be scoped to an
 * account and revocable with that account's relationship, and there is no
 * account to scope it to for an anonymous caller.
 *
 * `no-store`, with no ETag: this is a credential, and a credential must never
 * be revalidated out of a cache.
 *
 * Refresh is the same call. A client asks again shortly before expiry, and the
 * server re-runs the entire authorization — publication, unpublish, revocation,
 * relationship, account status — rather than extending what it issued before.
 * That is what makes a revocation stop playback that is already running.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = playbackGrantRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Could not start playback.");
    }

    const account = await getVisitorAccount(userId);
    if (!account) throw new MobileError("unauthenticated", "Sign in to continue.");

    // A refresh every minute per item is the designed rate; this is an order of
    // magnitude above it and well below anything that would let one account
    // farm capabilities for an item it is about to lose access to.
    const budget = await checkRateLimit(`media:playback:${account.id}`, {
      limit: 60,
      windowMs: 5 * 60 * 1000,
    });
    if (!budget.ok) {
      throw new MobileError("rate_limited", "Too many requests.", {
        retryAfterSeconds: budget.retryAfterSeconds,
      });
    }

    const grant = await grantPlayback({
      userId,
      churchSlug: parsed.data.churchSlug,
      kind: parsed.data.kind,
      mediaId: parsed.data.mediaId,
    });

    // Unpublished, revoked, never published, ended, blocked, wrong church — one
    // answer. A caller probing ids learns nothing about which exist.
    if (!grant) {
      throw new MobileError("not_found", "That is not available to watch.");
    }

    return { data: grant };
  },
);
