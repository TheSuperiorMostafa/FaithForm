import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import {
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { presentationArchiveEtag } from "@/lib/sermons/v1/etag";
import { getPresentationArchivePage } from "@/lib/sermons/v1/presentation-service";

export const dynamic = "force-dynamic";

const CURSOR_KIND = "presentation-archive";
const MAX_QUERY_LENGTH = 100;

/** Published slide decks for a church, newest first. */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const raw = decodeCursor(url.searchParams.get("cursor"), CURSOR_KIND);
    if (
      raw &&
      (raw.length !== 2 ||
        Number.isNaN(Date.parse(raw[0])) ||
        !/^[0-9a-f-]{36}$/i.test(raw[1]))
    ) {
      throw new MobileError("invalid_cursor", "Invalid cursor.");
    }
    const query = (url.searchParams.get("q") ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

    const page = await getPresentationArchivePage({
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
      presentationVersion: page.version,
    };

    const etag = presentationArchiveEtag({
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
