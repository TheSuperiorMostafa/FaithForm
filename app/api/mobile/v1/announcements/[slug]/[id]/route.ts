import { MobileError } from "@/lib/mobile/v1/errors";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { getFeedItem } from "@/lib/mobile/v1/feed-service";

export const dynamic = "force-dynamic";

/**
 * One announcement, resolved fresh.
 *
 * A notification tap lands here. If the item was edited, unpublished,
 * retargeted, or the relationship was revoked since the push was enqueued, this
 * is a 404 and the app says the item is no longer available — rather than
 * rendering whatever the notification claimed.
 */
export const GET = optionalAuthRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const item = await getFeedItem({
      userId,
      churchSlug: params.slug,
      announcementId: params.id,
    });
    if (!item) throw new MobileError("not_found", "This is no longer available.");
    return { data: item };
  },
);
