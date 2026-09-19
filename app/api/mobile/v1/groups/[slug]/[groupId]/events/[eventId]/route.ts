import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { upsertGroupEventRequestSchema } from "@/lib/mobile/v1/contract";
import { eventDetail, updateEvent } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await eventDetail(userId, params.slug, params.groupId, params.eventId) };
});

/** A leader edits a gathering. A generated one is then left alone by its schedule. */
export const PATCH = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const values = await parseBody(request, upsertGroupEventRequestSchema, "Check the gathering details.");
  return { data: await updateEvent(userId, params.slug, params.groupId, params.eventId, values) };
});
