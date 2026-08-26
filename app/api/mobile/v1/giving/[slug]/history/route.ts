import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseLimit } from "@/lib/mobile/v1/protocol";
import { getGivingHistory } from "@/lib/giving/v1/giving-service";

export const dynamic = "force-dynamic";

/**
 * This account's own giving at this church.
 *
 * Bound to the authenticated account and the church, both on the SQL statement.
 * There is no email path in — which matters more here than it looks: the
 * church's own donor records are keyed by email, and two people who share an
 * inbox would otherwise see each other's giving.
 *
 * Never cached. Giving history is not the kind of thing to leave in a shared
 * HTTP cache, and a `no-store` response is also what stops it being written to
 * an ordinary URL cache on the device.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request, params }) => {
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const rawBefore = url.searchParams.get("before");

    // A timestamp cursor, validated rather than trusted. An unparseable value
    // pages from the start instead of reaching SQL.
    const before =
      rawBefore && !Number.isNaN(Date.parse(rawBefore))
        ? new Date(rawBefore).toISOString()
        : null;

    return {
      data: await getGivingHistory({
        userId,
        churchSlug: params.slug,
        limit,
        before,
      }),
    };
  },
);
