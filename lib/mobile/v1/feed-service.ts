import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import {
  getAnnouncementDetail,
  getAnnouncementFeed,
  type FeedCursor,
} from "@/lib/faithful/announcements-feed";
import { resolveRelationshipState } from "@/lib/mobile/v1/discovery-service";
import type { FeedItemDto } from "@/lib/mobile/v1/contract";

/**
 * The Home feed.
 *
 * Authorization is re-derived on every request from the caller's own
 * relationship — never from a client-supplied state, and never from a cached
 * decision. A relationship revoked a second ago changes what this returns.
 */

type ChurchContext = { name: string; timezone: string };

async function loadChurchContext(slug: string): Promise<ChurchContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("name, timezone, is_discoverable")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return null;
  return {
    name: data.name as string,
    timezone: (data.timezone as string) ?? "America/New_York",
  };
}

function toDto(
  item: Awaited<ReturnType<typeof getAnnouncementFeed>>["items"][number],
  churchSlug: string,
  church: ChurchContext,
): FeedItemDto {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    startAt: item.startAt,
    endAt: item.endAt,
    location: item.location,
    posterUrl: item.posterUrl,
    posterAltText: item.posterAltText,
    isPinned: item.isPinned,
    visibility: item.visibility,
    publicationVersion: item.publicationVersion,
    publishedAt: item.publishedAt,
    // An end time is what makes something an event rather than a notice; the
    // client uses this to decide between a date range and a single timestamp.
    isEvent: item.endAt !== null,
    churchSlug,
    churchName: church.name,
    // The church's zone, not the device's: "Sunday 10am" means the church's
    // Sunday, and a traveller must not see it shifted.
    churchTimezone: church.timezone,
  };
}

export async function getFeedPage(input: {
  userId: string | null;
  churchSlug: string;
  limit: number;
  cursor: FeedCursor | null;
}): Promise<{ items: FeedItemDto[]; nextCursor: FeedCursor | null; feedVersion: number }> {
  const church = await loadChurchContext(input.churchSlug);
  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  const relationshipState = await resolveRelationshipState(
    input.userId,
    input.churchSlug,
  );

  const page = await getAnnouncementFeed({
    churchSlug: input.churchSlug,
    relationshipState,
    limit: input.limit,
    cursor: input.cursor,
  });

  return {
    items: page.items.map((item) => toDto(item, input.churchSlug, church)),
    nextCursor: page.nextCursor,
    feedVersion: page.maxVersion,
  };
}

/**
 * One announcement, re-authorized.
 *
 * This is what a notification tap resolves against. Returning null when the
 * item has been edited, withdrawn, retargeted, or the relationship revoked is
 * the point — the push payload is a hint, and this is the authority.
 */
export async function getFeedItem(input: {
  userId: string | null;
  churchSlug: string;
  announcementId: string;
}): Promise<FeedItemDto | null> {
  const church = await loadChurchContext(input.churchSlug);
  if (!church) return null;

  const relationshipState = await resolveRelationshipState(
    input.userId,
    input.churchSlug,
  );

  const item = await getAnnouncementDetail({
    churchSlug: input.churchSlug,
    announcementId: input.announcementId,
    relationshipState,
  });

  return item ? toDto(item, input.churchSlug, church) : null;
}
