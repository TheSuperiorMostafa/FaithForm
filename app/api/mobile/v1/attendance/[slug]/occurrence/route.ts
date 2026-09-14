import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getEligibleOccurrence } from "@/lib/mobile/v1/attendance-service";

export const dynamic = "force-dynamic";

/**
 * The occurrence a check-in would land on right now.
 *
 * Resolved server-side from the clock. Returning null is a normal answer —
 * outside a check-in window there is nothing to attend.
 *
 * `?regionId=faithform.campus.<uuid>` is optional: the OS region a phone
 * entered, exactly as the geofence configuration issued it. At a church with
 * several campuses it selects the service at that campus. It names a place the
 * church publishes, not a person, and it cannot select another church's
 * service because the lookup is scoped to the church in the path.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request, params }) => ({
    data: {
      occurrence: await getEligibleOccurrence(userId, params.slug, {
        regionId: new URL(request.url).searchParams.get("regionId")?.slice(0, 200) ?? null,
      }),
    },
  }),
);
