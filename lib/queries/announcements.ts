import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarEventPreview } from "@/lib/integrations/types";
import {
  computeAnnouncementStatus,
  type AnnouncementStatus,
} from "@/lib/queries/dashboard";

export type AnnouncementRow = {
  id: string;
  church_id: string;
  title: string;
  body: string;
  start_at: string;
  end_at: string | null;
  event_location: string | null;
  is_ready: boolean;
  push_to_app: boolean;
  push_to_facebook: boolean;
  push_to_team: boolean;
  status: string;
  google_event_id: string | null;
  google_calendar_id: string | null;
  facebook_post_id: string | null;
  facebook_caption?: string | null;
  social_graphic_url?: string | null;
  social_graphic_path?: string | null;
  gmail_draft_id: string | null;
  published_at: string | null;
  last_publish_error: string | null;
  created_at: string;
  updated_at: string;
  computed_status?: AnnouncementStatus;
};

export type CalendarQueueItem = CalendarEventPreview & {
  announcementId?: string;
  published?: boolean;
};

export async function getAnnouncements(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AnnouncementRow[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select(
      "id, church_id, title, body, start_at, end_at, event_location, is_ready, push_to_app, push_to_facebook, push_to_team, status, google_event_id, google_calendar_id, facebook_post_id, gmail_draft_id, published_at, last_publish_error, created_at, updated_at, event_title, event_date, notes",
    )
    .eq("church_id", churchId)
    .order("start_at", { ascending: false, nullsFirst: false });

  if (error || !data) return [];

  return data.map((row) => mapAnnouncementRow(row));
}

export async function getAnnouncement(
  supabase: SupabaseClient,
  churchId: string,
  id: string,
): Promise<AnnouncementRow | null> {
  const { data, error } = await supabase
    .from("announcements")
    .select(
      "id, church_id, title, body, start_at, end_at, event_location, is_ready, push_to_app, push_to_facebook, push_to_team, status, google_event_id, google_calendar_id, facebook_post_id, gmail_draft_id, published_at, last_publish_error, created_at, updated_at, event_title, event_date, notes",
    )
    .eq("church_id", churchId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  return mapAnnouncementRow(data);
}

export async function getPublishedGoogleEventIds(
  supabase: SupabaseClient,
  churchId: string,
): Promise<Set<string>> {
  const map = await getPublishedAnnouncementsByGoogleId(supabase, churchId);
  return new Set(Object.keys(map));
}

/** Map google_event_id -> announcement id for published rows. */
export async function getPublishedAnnouncementsByGoogleId(
  supabase: SupabaseClient,
  churchId: string,
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("announcements")
    .select("id, google_event_id")
    .eq("church_id", churchId)
    .eq("status", "published")
    .not("google_event_id", "is", null);

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const gid = row.google_event_id as string;
    if (gid) map[gid] = row.id as string;
  }
  return map;
}

export async function getPublishedAnnouncements(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AnnouncementRow[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select(
      "id, church_id, title, body, start_at, end_at, event_location, is_ready, push_to_app, push_to_facebook, push_to_team, status, google_event_id, google_calendar_id, facebook_post_id, gmail_draft_id, published_at, last_publish_error, created_at, updated_at, event_title, event_date, notes",
    )
    .eq("church_id", churchId)
    .eq("status", "published")
    .order("published_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => mapAnnouncementRow(row));
}

export function buildCalendarQueue(
  events: CalendarEventPreview[],
  publishedIds: Set<string>,
): CalendarQueueItem[] {
  return events
    .filter((e) => !publishedIds.has(e.googleEventId))
    .map((e) => ({ ...e, published: false }));
}

function mapAnnouncementRow(row: Record<string, unknown>): AnnouncementRow {
  const title = (row.title as string) || (row.event_title as string) || "";
  const body = (row.body as string) || (row.notes as string) || "";
  const startAt =
    (row.start_at as string) || (row.event_date as string) || new Date().toISOString();

  return {
    id: row.id as string,
    church_id: row.church_id as string,
    title,
    body,
    start_at: startAt,
    end_at: (row.end_at as string | null) ?? null,
    event_location: (row.event_location as string | null) ?? null,
    is_ready: Boolean(row.is_ready),
    push_to_app: Boolean(row.push_to_app),
    push_to_facebook: Boolean(row.push_to_facebook),
    push_to_team: Boolean(row.push_to_team),
    status: (row.status as string) ?? "pending",
    google_event_id: (row.google_event_id as string | null) ?? null,
    google_calendar_id: (row.google_calendar_id as string | null) ?? null,
    facebook_post_id: (row.facebook_post_id as string | null) ?? null,
    gmail_draft_id: (row.gmail_draft_id as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    last_publish_error: (row.last_publish_error as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    computed_status: computeAnnouncementStatus(
      Boolean(row.is_ready),
      startAt,
      (row.end_at as string | null) ?? null,
    ),
  };
}

export function groupAnnouncementsByStatus(
  announcements: AnnouncementRow[],
): Record<AnnouncementStatus, AnnouncementRow[]> {
  return {
    draft: announcements.filter((a) => a.computed_status === "draft"),
    scheduled: announcements.filter((a) => a.computed_status === "scheduled"),
    active: announcements.filter((a) => a.computed_status === "active"),
    ended: announcements.filter((a) => a.computed_status === "ended"),
  };
}

export function formatDateTimeRange(
  startAt: string,
  endAt: string | null,
): string {
  const start = new Date(startAt);
  const startStr = start.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  if (!endAt) return `${startStr} – ongoing`;

  const end = new Date(endAt);
  const endStr = end.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return `${startStr} – ${endStr}`;
}

/**
 * Separate date and time lines for Facebook announcement graphics.
 * Time is start-only (e.g. "6:00 PM"), not a range — keeps the flyer clean.
 */
export function formatEventGraphicDetails(
  startAt: string,
  _endAt?: string | null,
): { dateLine: string; timeLine: string } {
  const start = new Date(startAt);

  const dateLine = start
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();

  const timeLine = start
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();

  return { dateLine, timeLine };
}

export function buildFacebookPostMessage(input: {
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  notes?: string;
}): string {
  const when = formatDateTimeRange(input.startAt, input.endAt);
  const lines = [input.title, when];
  if (input.location) lines.push(`📍 ${input.location}`);
  if (input.notes?.trim()) lines.push("", input.notes.trim());
  return lines.join("\n");
}
