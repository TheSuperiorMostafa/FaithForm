import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { queryParam } from "@/lib/mobile/v1/body";
import { resolveChatRoute } from "@/lib/messaging/routes";

export const dynamic = "force-dynamic";

/**
 * Where a chat notification should open, decided now. The push is a hint:
 * a conversation the person has since left, or was never in, is a 404 and the
 * app says it is no longer available.
 */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, request }) => {
  const cid = queryParam(request, "cid", 80);
  if (!cid) throw new MobileError("invalid_request", "That conversation is no longer available.");
  return { data: await resolveChatRoute(userId, cid, queryParam(request, "messageId", 128)) };
});
