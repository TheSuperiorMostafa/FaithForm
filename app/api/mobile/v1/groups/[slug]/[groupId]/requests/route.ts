import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { listRequests } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** Pending requests to join, oldest first. Leaders only. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await listRequests(userId, params.slug, params.groupId) };
});
