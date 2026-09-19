import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { setGroupNotificationRequestSchema } from "@/lib/mobile/v1/contract";
import { setGroupNotificationLevel } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** This group's notifications for the caller: default, all, mentions, or muted. */
export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, setGroupNotificationRequestSchema);
  return { data: await setGroupNotificationLevel(userId, params.slug, params.groupId, body.level) };
});
