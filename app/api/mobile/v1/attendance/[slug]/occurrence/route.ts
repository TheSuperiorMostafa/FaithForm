import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getEligibleOccurrence } from "@/lib/mobile/v1/attendance-service";

export const dynamic = "force-dynamic";

/**
 * The occurrence a check-in would land on right now.
 *
 * Resolved server-side from the clock. Returning null is a normal answer —
 * outside a check-in window there is nothing to attend.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => ({
    data: { occurrence: await getEligibleOccurrence(userId, params.slug) },
  }),
);
