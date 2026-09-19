import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { setMessagingLevelRequestSchema } from "@/lib/mobile/v1/contract";
import { messagingPreferences, setMessagingLevel } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** Message notifications: the church-wide level, and each group's own choice. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await messagingPreferences(userId, params.slug) };
});

export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, setMessagingLevelRequestSchema);
  return { data: await setMessagingLevel(userId, params.slug, body.level) };
});
