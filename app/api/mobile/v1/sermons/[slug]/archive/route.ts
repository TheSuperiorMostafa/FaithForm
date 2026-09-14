import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import {
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { sermonArchiveEtag } from "@/lib/sermons/v1/etag";
import { getSermonArchivePage } from "@/lib/sermons/v1/sermon-service";

export const dynamic = "force-dynamic";

/**
 * A cursor kind of its own, so a cursor minted for the media archive or the
 * announcement feed can never page this list. Renamed when the order changed
 * from "when it was shared" to "when it was preached" (migration 0075): a
 * cursor from the old order would page from the wrong place, so it is refused
 * as invalid rather than accepted.
 */
const CURSOR_KIND = "sermon-history";

/** A search box, not a query language. */
const MAX_QUERY_LENGTH = 100;

/**
 * Shared sermon notes, most recently preached first.
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
    // Checked here because the values go straight into typed SQL parameters: a
    // malformed one would otherwise surface as a database error, which the
    // service now (rightly) reports as the server being unavailable.
    if (
      raw &&
      (raw.length !== 3 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(raw[0]) ||
        Number.isNaN(Date.parse(raw[1])) ||
        !/^[0-9a-f-]{36}$/i.test(raw[2]))
    ) {
      throw new MobileError("invalid_cursor", "Invalid cursor.");
    }
    const query = (url.searchParams.get("q") ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

    const page = await getSermonArchivePage({
      userId,
      churchSlug: params.slug,
      limit,
      cursor: raw
        ? { preachedOn: raw[0], publishedAt: raw[1], id: raw[2] }
        : null,
      query: query || null,
    });

    const data = {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeCursor(CURSOR_KIND, [
            page.nextCursor.preachedOn,
            page.nextCursor.publishedAt,
            page.nextCursor.id,
          ])
        : null,
      sermonVersion: page.version,
    };

    const etag = sermonArchiveEtag({
      ...data,
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
