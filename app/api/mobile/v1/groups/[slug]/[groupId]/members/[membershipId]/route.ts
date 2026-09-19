import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { setGroupRoleRequestSchema } from "@/lib/mobile/v1/contract";
import { changeRole } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** A manager changes someone's role. Nobody changes their own. */
export const PATCH = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, setGroupRoleRequestSchema);
  return { data: await changeRole(userId, params.slug, params.groupId, params.membershipId, body.groupRole) };
});
