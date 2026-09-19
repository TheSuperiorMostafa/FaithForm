import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { groupInvitationTokenRequestSchema } from "@/lib/mobile/v1/contract";
import { acceptInvitation } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * Redeems a share link for the signed-in person. The link names the group;
 * the person must already belong to that church in the app.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, request }) => {
  const body = await parseBody(request, groupInvitationTokenRequestSchema, "That invitation link is not valid.");
  const result = await acceptInvitation(userId, body.token);
  return { data: { outcome: result.outcome, group: result.group } };
});
