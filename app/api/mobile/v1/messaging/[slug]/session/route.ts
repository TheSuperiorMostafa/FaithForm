import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { issueMemberChatSession } from "@/lib/messaging/session";

export const dynamic = "force-dynamic";

/**
 * A chat credential for the signed-in person at this church: the provider's
 * public app key, their own chat id, and a one-hour token for that id alone.
 * The chat SDKs call this again (a token provider) before the hour is up.
 * The app secret never leaves the server.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await issueMemberChatSession(userId, params.slug) };
});
