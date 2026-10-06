import { createAdminClient } from "@/lib/supabase/admin";
import { grantsPublishedContentAccess } from "@/lib/faithform/relationship-state";
import { isSundayDate, isWorshipLabel } from "@/lib/attendance/v2/sunday-worship";
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

type ChurchContext = { id: string; name: string; timezone: string };

async function loadChurchContext(slug: string): Promise<ChurchContext | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("id, name, timezone, is_discoverable")
    .eq("slug", slug)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
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

type ScheduleDependencies = {
  church: typeof loadChurchContext;
  relationship: typeof resolvePublishedContentRelationshipState;
  announcements: typeof getAnnouncementSchedule;
  services: typeof getServiceSchedule;
};
const scheduleDependencies: ScheduleDependencies = {
  church: loadChurchContext, relationship: resolvePublishedContentRelationshipState,
  announcements: getAnnouncementSchedule, services: getServiceSchedule,
};

export async function getScheduleWindow(input: {
  userId: string | null;
  churchSlug: string;
  from: string;
  to: string;
}, dependencies: ScheduleDependencies = scheduleDependencies): Promise<{ items: FeedItemDto[]; scheduleVersion: number }> {
  const church = await dependencies.church(input.churchSlug);
  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 93 * 24 * 60 * 60 * 1000) {
    throw new VisitorError("invalid_input", "Invalid schedule window.");
  }

  const relationshipState = await dependencies.relationship(
    input.userId,
    input.churchSlug,
  );

  const items = await dependencies.announcements({
    churchSlug: input.churchSlug,
    relationshipState,
    from: input.from,
    to: input.to,
  });

  // Service timing is available to related accounts; no attendance or People
  // data is read. Existing occurrences are read without creating any on GET.
  const services = input.userId && relationshipState && grantsPublishedContentAccess(relationshipState)
    ? await dependencies.services(church, input.churchSlug, input.from, input.to)
    : [];
  const combined = [...items.map((item) => toDto(item, input.churchSlug, church)), ...services]
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  return {
    items: combined,
    scheduleVersion: combined.reduce(
      (max, item) => Math.max(max, item.publicationVersion),
      0,
    ),
  };
}

async function getServiceSchedule(church: ChurchContext, churchSlug: string, from: string, to: string): Promise<FeedItemDto[]> {
  const { data, error } = await createAdminClient()
    .from("service_occurrences")
    .select("id, label, local_service_date, starts_at_utc, ends_at_utc, policy_version, church_campuses(name)")
    .eq("church_id", church.id)
    .is("group_id", null)
    .neq("status", "cancelled")
    .lt("starts_at_utc", to)
    .gt("ends_at_utc", from)
    .order("starts_at_utc", { ascending: true })
    .limit(200);
  if (error) throw new VisitorError("unavailable", "Could not load services.");
  return (data ?? []).filter(row => isSundayDate(row.local_service_date) && isWorshipLabel(row.label)).map(row => {
    const campus = row.church_campuses as unknown as { name: string } | { name: string }[] | null;
    return {
      id: `service:${row.id}`, serviceOccurrenceId: row.id,
      title: row.label, body: "Join us for Sunday worship.",
      startAt: row.starts_at_utc, endAt: row.ends_at_utc,
      allDay: false, location: (Array.isArray(campus) ? campus[0]?.name : campus?.name) ?? null,
      posterUrl: null, posterAltText: null, isPinned: false, visibility: "followers",
      publicationVersion: Number(row.policy_version ?? 1), publishedAt: null,
      isEvent: true, churchSlug, churchName: church.name, churchTimezone: church.timezone,
    };
  });
}
