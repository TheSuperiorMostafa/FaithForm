import { z } from "zod";

import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { cancelEvent } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** A leader cancels a gathering; the people who said they were coming are told. */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, cancelSchema);
  return { data: await cancelEvent(userId, params.slug, params.groupId, params.eventId, body.reason?.trim() || null) };
});
