import { VisitorError } from "@/lib/faithform/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getScheduleWindow } from "@/lib/mobile/v1/schedule-service";

export const dynamic = "force-dynamic";

/**
 * Published events for one church in a calendar window.
 *
 * Readable signed out for public items, but the relationship shapes what comes
 * back, so it is never shared-cached.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
      throw new VisitorError("validation", "from and to are required.");
    }

    const page = await getScheduleWindow({
      userId,
      churchSlug: params.slug,
      from,
      to,
    });

    const etag = computeEtag({
      version: page.scheduleVersion,
      ids: page.items.map((item) => `${item.id}:${item.publicationVersion}`),
      scope: `${userId ? "member" : "anonymous"}:${from}:${to}`,
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data: page, etag };
  },
);
