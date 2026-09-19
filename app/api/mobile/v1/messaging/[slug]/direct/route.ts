import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { startDirectMessageRequestSchema } from "@/lib/mobile/v1/contract";
import { startDirectConversation } from "@/lib/messaging/direct";

export const dynamic = "force-dynamic";

/**
 * Opens (or returns) the one direct conversation between the caller and
 * another person at this church — only when the church's policy, both
 * people's standing and blocks allow it. Clients cannot create channels.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, startDirectMessageRequestSchema);
  return { data: await startDirectConversation(userId, params.slug, body.chatUserId) };
});
