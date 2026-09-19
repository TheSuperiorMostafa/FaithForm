import { MobileError } from "@/lib/mobile/v1/errors";
import { publicRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { groupInvitationTokenRequestSchema } from "@/lib/mobile/v1/contract";
import { previewInvitation } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/**
 * Names the group behind a share link, before anything is decided. POST so
 * the token stays out of URLs and logs. Every unusable link — expired,
 * revoked, spent or unknown — is the same 404.
 */
export const POST = publicRoute({ cache: "private-no-store" }, async ({ request }) => {
  const body = await parseBody(request, groupInvitationTokenRequestSchema, "That invitation link is not valid.");
  const preview = await previewInvitation(body.token);
  if (!preview) throw new MobileError("not_found", "That invitation is not valid.");
  return { data: preview };
});
