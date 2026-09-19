import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { decideGroupRequestSchema } from "@/lib/mobile/v1/contract";
import { decide } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** Approve or decline one request. Capacity is re-checked at approval. */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, decideGroupRequestSchema);
  return { data: await decide(userId, params.slug, params.groupId, params.requestId, body.decision) };
});
