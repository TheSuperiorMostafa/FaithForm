import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { leave } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** Leave the group, or withdraw a pending request. Always allowed. */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await leave(userId, params.slug, params.groupId) };
});
