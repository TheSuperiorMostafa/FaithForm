import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody, queryParam } from "@/lib/mobile/v1/body";
import { chatBlockRequestSchema } from "@/lib/mobile/v1/contract";
import { blockPerson, listBlocked, unblockPerson } from "@/lib/messaging/safety";

export const dynamic = "force-dynamic";

/** People the caller has blocked. Personal: nobody else, staff included, reads it. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await listBlocked(userId, params.slug) };
});

/**
 * Block someone: neither can message the other directly, an existing
 * conversation freezes, and their messages are hidden from the caller.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, chatBlockRequestSchema);
  return { data: await blockPerson(userId, params.slug, body.chatUserId) };
});

export const DELETE = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const chatUserId = queryParam(request, "chatUserId", 40);
  if (!chatUserId) throw new MobileError("invalid_request", "Choose someone to unblock.");
  return { data: await unblockPerson(userId, params.slug, chatUserId) };
});
