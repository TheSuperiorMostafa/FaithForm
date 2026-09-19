import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody, queryParam } from "@/lib/mobile/v1/body";
import { upsertGroupEventRequestSchema } from "@/lib/mobile/v1/contract";
import { parseLimit } from "@/lib/mobile/v1/protocol";
import { createEvent, listEvents } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** The group's gatherings — upcoming (default) or past. Members only. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const when = queryParam(request, "when", 10) === "past" ? "past" : "upcoming";
  return {
    data: await listEvents(userId, params.slug, params.groupId, {
      when,
      cursor: queryParam(request, "cursor", 512),
      limit: parseLimit(queryParam(request, "limit", 4)),
    }),
  };
});

/** A leader adds a gathering. */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const values = await parseBody(request, upsertGroupEventRequestSchema, "Check the gathering details.");
  return { data: await createEvent(userId, params.slug, params.groupId, values) };
});
