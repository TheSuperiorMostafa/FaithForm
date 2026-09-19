import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { removeGroupMemberRequestSchema } from "@/lib/mobile/v1/contract";
import { removeMember } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * A leader removes someone — optionally banning them from rejoining. Their
 * access to the conversation goes with it, through the reconciler.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, removeGroupMemberRequestSchema);
  return {
    data: await removeMember(userId, params.slug, params.groupId, params.membershipId, {
      ban: body.ban,
      reason: body.reason?.trim() || null,
    }),
  };
});
