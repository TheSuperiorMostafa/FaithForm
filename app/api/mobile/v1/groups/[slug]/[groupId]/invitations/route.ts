import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { createInvitation } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * A share link for the group, for its leaders. The token is returned once,
 * inside the link; only its hash is stored.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await createInvitation(userId, params.slug, params.groupId) };
});
