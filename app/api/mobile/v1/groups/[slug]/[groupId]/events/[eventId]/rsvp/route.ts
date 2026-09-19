import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { groupEventRsvpRequestSchema } from "@/lib/mobile/v1/contract";
import { rsvp } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** Going, maybe, or not going. Idempotent: the answer replaces the last one. */
export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, groupEventRsvpRequestSchema);
  return { data: await rsvp(userId, params.slug, params.groupId, params.eventId, body.response) };
});
