import { publicRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { searchNearby } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

/**
 * Nearby churches.
 *
 * POST rather than GET, deliberately: coordinates in a query string end up in
 * access logs, proxy logs, and Referer headers. In a body they are used for
 * this one query and discarded.
 *
 * `no-store` for the same reason — a location-derived result must never sit in
 * any cache, shared or otherwise.
 */
export const POST = publicRoute(
  { cache: "private-no-store" },
  async ({ request }) => ({
    data: { items: await searchNearby(await readJsonBody(request)), nextCursor: null },
  }),
);
