import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { queryParam } from "@/lib/mobile/v1/body";
import { resolveChatCard } from "@/lib/messaging/cards";

export const dynamic = "force-dynamic";

/**
 * What a shared FaithForm card shows this reader, now. The message carries
 * only `{kind, id}`; the conversation (`cid`) must be one the reader is in.
 */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const kind = queryParam(request, "kind", 40);
  const id = queryParam(request, "id", 64);
  const cid = queryParam(request, "cid", 80);
  if (!kind || !id || !cid) throw new MobileError("invalid_request", "That card can't be shown.");
  return { data: await resolveChatCard(userId, params.slug, { kind, id, cid }) };
});
