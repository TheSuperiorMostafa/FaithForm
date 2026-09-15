import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import {
  getAnnouncementSchedule,
  type FeedItem,
} from "@/lib/faithform/announcements-feed";
import { resolvePublishedContentRelationshipState } from "@/lib/mobile/v1/discovery-service";
import type { FeedItemDto } from "@/lib/mobile/v1/contract";

/**
 * The Home Schedule calendar.
 *
 * Returns every published event whose window overlaps the requested month
 * window, re-authorized for the caller's relationship on every request.
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
  item: FeedItem,
  churchSlug: string,
  church: ChurchContext,
): FeedItemDto {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    startAt: item.startAt,
    endAt: item.endAt,
    allDay: item.allDay,
    location: item.location,
    posterUrl: item.posterUrl,
    posterAltText: item.posterAltText,
    isPinned: item.isPinned,
    visibility: item.visibility,
    publicationVersion: item.publicationVersion,
    publishedAt: item.publishedAt,
    isEvent: item.endAt !== null,
    churchSlug,
    churchName: church.name,
    churchTimezone: church.timezone,
  };
}

export async function getScheduleWindow(input: {
  userId: string | null;
  churchSlug: string;
  from: string;
  to: string;
}): Promise<{ items: FeedItemDto[]; scheduleVersion: number }> {
  const church = await loadChurchContext(input.churchSlug);
  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new VisitorError("invalid_input", "Invalid schedule window.");
  }

  const relationshipState = await resolvePublishedContentRelationshipState(
    input.userId,
    input.churchSlug,
  );

  const items = await getAnnouncementSchedule({
    churchSlug: input.churchSlug,
    relationshipState,
    from: input.from,
    to: input.to,
  });

  return {
    items: items.map((item) => toDto(item, input.churchSlug, church)),
    scheduleVersion: items.reduce(
      (max, item) => Math.max(max, item.publicationVersion),
      0,
    ),
  };
}
