import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getBootstrap } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

/**
 * Everything the app needs on launch, in one round trip.
 *
 * `serverTime` is excluded from the ETag on purpose: it changes every request,
 * and including it would defeat conditional revalidation entirely.
 */
export const GET = authenticatedRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId }) => {
    const bootstrap = await getBootstrap(userId);

    const { serverTime: _ignored, ...stable } = bootstrap;
    const etag = computeEtag(stable);

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }

    return { data: bootstrap, etag };
  },
);
