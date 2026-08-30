import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import {
  computeEtag,
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { getSermonArchivePage } from "@/lib/sermons/v1/sermon-service";

export const dynamic = "force-dynamic";

/**
 * A cursor kind of its own, so a cursor minted for the media archive or the
 * announcement feed can never page this list.
 */
const CURSOR_KIND = "sermon-archive";

/** A search box, not a query language. */
const MAX_QUERY_LENGTH = 100;

/**
 * Published sermon notes, newest first.
 *
 * Search runs *after* the publication and relationship filters, in SQL, so an
 * unpublished sermon's title cannot surface through the search box.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const raw = decodeCursor(url.searchParams.get("cursor"), CURSOR_KIND);
    const query = (url.searchParams.get("q") ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

    const page = await getSermonArchivePage({
      userId,
      churchSlug: params.slug,
      limit,
      cursor: raw ? { publishedAt: raw[0], id: raw[1] } : null,
      query: query || null,
    });

    const data = {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeCursor(CURSOR_KIND, [
            page.nextCursor.publishedAt,
            page.nextCursor.id,
          ])
        : null,
      sermonVersion: page.version,
    };

    const etag = computeEtag({
      version: page.version,
      // The per-item version is what makes an edit to any single sermon change
      // the list's validator.
      ids: page.items.map(
        (item) => `${item.sermonId}:${item.publicationVersion}`,
      ),
      cursor: url.searchParams.get("cursor") ?? "",
      query,
      scope: userId ? "member" : "anonymous",
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data, etag };
  },
);
