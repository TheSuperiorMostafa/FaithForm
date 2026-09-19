import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { groupFilters } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** The categories, campuses and meeting days that Discover can filter by. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await groupFilters(userId, params.slug) };
});
