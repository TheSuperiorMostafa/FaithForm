import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { groupAvailabilitySchema } from "@/lib/mobile/v1/contract";
import { memberAvailability } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => ({
  data: await memberAvailability(userId, params.slug, params.groupId),
}));
export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, groupAvailabilitySchema);
  return { data: await memberAvailability(userId, params.slug, params.groupId, body.availability) };
});
