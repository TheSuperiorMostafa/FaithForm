import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { queryParam } from "@/lib/mobile/v1/body";
import { parseLimit } from "@/lib/mobile/v1/protocol";
import { discoverGroups } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * Groups anyone at this church can find: public and active. Unlisted and
 * private groups never appear here, whatever the filters say.
 */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const day = queryParam(request, "day", 2);
  return {
    data: await discoverGroups(userId, params.slug, {
      query: queryParam(request, "q", 80),
      typeId: queryParam(request, "type", 64),
      dayOfWeek: day !== null && /^[0-6]$/.test(day) ? Number(day) : null,
      campusId: queryParam(request, "campus", 64),
      openOnly: queryParam(request, "open", 5) === "true",
      cursor: queryParam(request, "cursor", 512),
      limit: parseLimit(queryParam(request, "limit", 4)),
    }),
  };
});
