import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { publicRoute } from "@/lib/mobile/v1/handler";
import {
  computeEtag,
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { searchChurches } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

const CURSOR_KIND = "church-search";

/**
 * Manual search. Anonymous by design and requiring no location permission —
 * someone deciding whether to use Faithful at all must be able to look.
 *
 * Shared-cacheable: the result is identical for everyone, and only
 * discoverable churches are ever returned.
 */
export const GET = publicRoute(
  { cache: "public-short" },
  async ({ request, requestId }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCursor(url.searchParams.get("cursor"), CURSOR_KIND);

    const page = await searchChurches({
      query: url.searchParams.get("q") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      postalCode: url.searchParams.get("postalCode") ?? undefined,
      limit,
      cursorName: cursor?.[0] ?? null,
      cursorId: cursor?.[1] ?? null,
    });

    const data = {
      items: page.items,
      nextCursor: page.nextCursor
        ? encodeCursor(CURSOR_KIND, [page.nextCursor.name, page.nextCursor.id])
        : null,
    };

    const etag = computeEtag(data);
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "public-short", etag });
    }
    return { data, etag };
  },
);
