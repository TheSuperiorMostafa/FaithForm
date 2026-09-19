import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { queryParam } from "@/lib/mobile/v1/body";
import { parseLimit } from "@/lib/mobile/v1/protocol";
import { listMessageableContacts } from "@/lib/messaging/direct";

export const dynamic = "force-dynamic";

/**
 * People the caller may start a direct conversation with under their church's
 * policy. Empty when the policy is off — never a church directory by default.
 */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  return {
    data: await listMessageableContacts(userId, params.slug, {
      query: queryParam(request, "q", 80),
      cursor: queryParam(request, "cursor", 512),
      limit: parseLimit(queryParam(request, "limit", 4)),
    }),
  };
});
