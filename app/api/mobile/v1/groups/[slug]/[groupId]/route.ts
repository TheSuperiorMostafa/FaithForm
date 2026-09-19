import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { updateGroupDetailsRequestSchema } from "@/lib/mobile/v1/contract";
import { groupDetail, updateDetails } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * One group, as the caller may see it. A private group the caller is not in,
 * another church's group and a group that never existed are the same 404.
 */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await groupDetail(userId, params.slug, params.groupId) };
});

/** A manager edits their group's details. */
export const PATCH = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const values = await parseBody(request, updateGroupDetailsRequestSchema, "Check the group details.");
  return { data: await updateDetails(userId, params.slug, params.groupId, values) };
});
