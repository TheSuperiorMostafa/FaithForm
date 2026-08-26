import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseLimit } from "@/lib/mobile/v1/protocol";
import { getOwnHistory } from "@/lib/mobile/v1/attendance-service";

export const dynamic = "force-dynamic";

/**
 * The account's own attendance history.
 *
 * Only what its verified People link shows, and only for that church. Reversed
 * entries are included and labelled — someone should be able to see that a
 * check-in was removed rather than find it silently gone.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request, params }) => {
    const limit = parseLimit(new URL(request.url).searchParams.get("limit"));
    return { data: await getOwnHistory(userId, params.slug, limit) };
  },
);
