import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import {
  computeEtag,
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
} from "@/lib/mobile/v1/protocol";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { listRelationshipsPage } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

const CURSOR_KIND = "relationships";

export const GET = authenticatedRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const cursor = decodeCursor(url.searchParams.get("cursor"), CURSOR_KIND);

    const page = await listRelationshipsPage(userId, {
      limit,
      cursorId: cursor?.[0] ?? null,
    });

    const data = {
      items: page.items,
      nextCursor: page.nextCursorId
        ? encodeCursor(CURSOR_KIND, [page.nextCursorId])
        : null,
    };

    const etag = computeEtag(data);
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }

    return { data, etag };
  },
);
