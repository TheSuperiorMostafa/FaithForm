import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { joinGroupRequestSchema } from "@/lib/mobile/v1/contract";
import { join } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * Join, or ask to join. What happens is the group's own policy, decided in one
 * transaction on the server (capacity included); the app renders whichever
 * outcome comes back rather than predicting it.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, joinGroupRequestSchema);
  return { data: await join(userId, params.slug, params.groupId, body.message?.trim() || null) };
});
