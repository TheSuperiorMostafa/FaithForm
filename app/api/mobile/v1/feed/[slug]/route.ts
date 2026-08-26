import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import {
  computeEtag,
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { getFeedPage } from "@/lib/mobile/v1/feed-service";

export const dynamic = "force-dynamic";

const CURSOR_KIND = "feed";

/**
 * The published feed for one church.
 *
 * Readable signed out — a public announcement is public — but what comes back
 * depends on the caller's relationship, so it is never shared-cached. The ETag
 * folds in the relationship state as well as the content version, because the
 * same church at the same version shows different things to a follower and to
 * a member.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const raw = decodeCursor(url.searchParams.get("cursor"), CURSOR_KIND);

    const page = await getFeedPage({
      userId,
      churchSlug: params.slug,
      limit,
      cursor: raw
        ? { pinned: raw[0] === "1", startAt: raw[1], id: raw[2] }
        : null,
    });

    const data = {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeCursor(CURSOR_KIND, [
            page.nextCursor.pinned ? "1" : "0",
            page.nextCursor.startAt,
            page.nextCursor.id,
          ])
        : null,
      feedVersion: page.feedVersion,
    };

    const etag = computeEtag({
      version: page.feedVersion,
      ids: page.items.map((item) => `${item.id}:${item.publicationVersion}`),
      // Two different relationships must not share a validator.
      scope: userId ? "member" : "anonymous",
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data, etag };
  },
);
