import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getAttendanceCapability } from "@/lib/mobile/v1/attendance-service";

export const dynamic = "force-dynamic";

/**
 * What this account may do at the open occurrence.
 *
 * Carries no campus coordinates and no radius: telling a client where the
 * boundary is would turn "am I inside" into a solvable puzzle.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => ({
    data: { capability: await getAttendanceCapability(userId, params.slug) },
  }),
);
