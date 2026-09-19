import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { queryParam } from "@/lib/mobile/v1/body";
import { parseLimit } from "@/lib/mobile/v1/protocol";
import { listMembers } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** The roster, for members when the group shows it, and always for leaders. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  return {
    data: await listMembers(userId, params.slug, params.groupId, {
      query: queryParam(request, "q", 80),
      cursor: queryParam(request, "cursor", 512),
      limit: parseLimit(queryParam(request, "limit", 4)),
    }),
  };
});
