import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import {
  computeEtag,
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { getArchivePage } from "@/lib/media/v1/media-service";

export const dynamic = "force-dynamic";

/**
 * A cursor kind of its own.
 *
 * `decodeCursor` refuses a cursor whose kind does not match, so a cursor minted
 * for the announcement feed — or for another church's archive, since the church
 * is in the path and the cursor is validated against this list's ordering — can
 * never page this one.
 */
const CURSOR_KIND = "media-archive";

/** A search box, not a query language. */
const MAX_QUERY_LENGTH = 100;

/**
 * Published recordings, newest first.
 *
 * Search runs *after* the publication and relationship filters, in SQL, so an
 * unpublished recording's title cannot surface through the search box — which
 * is the usual way private metadata leaks out of an otherwise correct list.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const raw = decodeCursor(url.searchParams.get("cursor"), CURSOR_KIND);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

    const page = await getArchivePage({
      userId,
      churchSlug: params.slug,
      limit,
      cursor: raw ? { publishedAt: raw[0], id: raw[1] } : null,
      query: query || null,
    });

    const data = {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeCursor(CURSOR_KIND, [page.nextCursor.publishedAt, page.nextCursor.id])
        : null,
      mediaVersion: page.version,
    };

    const etag = computeEtag({
      version: page.version,
      // The per-item version is what makes an edit to any single recording
      // change the list's validator.
      ids: page.items.map((item) => `${item.mediaId}:${item.publicationVersion}`),
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
