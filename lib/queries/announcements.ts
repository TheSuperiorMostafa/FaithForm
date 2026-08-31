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
  /** Date-only event: `start_at` is midnight UTC and carries no real time. */
  all_day?: boolean;
  event_location: string | null;
  is_ready: boolean;
  push_to_app: boolean;
  push_to_facebook: boolean;
  push_to_team: boolean;
  status: string;
  google_event_id: string | null;
  google_calendar_id: string | null;
  facebook_post_id: string | null;
  facebook_scheduled_publish_time?: string | null;
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

/**
 * Column list for a full announcement row.
 *
 * `facebook_scheduled_publish_time` arrived in migration 0014 and `all_day` in
 * 0066, and a database can be missing either. Naming an absent column makes
 * PostgREST reject the whole query, so every one of these reads returned
 * nothing at all — the Submitted list simply never appeared, with no error
 * anywhere. Each optional column is therefore dropped and the read retried;
 * `mapAnnouncementRow` already defaults every one of them.
 */
const ANNOUNCEMENT_COLUMNS =
  "id, church_id, title, body, start_at, end_at, all_day, event_location, is_ready, push_to_app, push_to_facebook, push_to_team, status, google_event_id, google_calendar_id, facebook_post_id, facebook_scheduled_publish_time, gmail_draft_id, published_at, last_publish_error, created_at, updated_at, event_title, event_date, notes";

const OPTIONAL_ANNOUNCEMENT_COLUMNS = [
  "facebook_scheduled_publish_time",
  "all_day",
] as const;

export function isMissingFacebookScheduleColumn(message: string): boolean {
  return /facebook_scheduled_publish_time/i.test(message);
}

type AnnouncementSelect = {
  data: unknown;
  error: { message: string } | null;
};

function withoutColumn(columns: string, column: string): string {
  return columns
    .split(", ")
    .filter((name) => name !== column)
    .join(", ");
}

/**
 * Runs a select with the full column list, retrying without whichever optional
 * columns this database turns out not to have.
 *
 * The column list is chosen at runtime, so PostgREST cannot infer a row type
 * here; callers cast to `Record<string, unknown>` and hand it to
 * `mapAnnouncementRow`, which reads every field defensively anyway.
 */
async function selectAnnouncements(
  build: (columns: string) => PromiseLike<AnnouncementSelect>,
): Promise<AnnouncementSelect> {
  let columns = ANNOUNCEMENT_COLUMNS;
  let result = await build(columns);

  for (let attempt = 0; attempt < OPTIONAL_ANNOUNCEMENT_COLUMNS.length; attempt++) {
    const message = result.error?.message;
    if (!message) return result;

    const missing = OPTIONAL_ANNOUNCEMENT_COLUMNS.find(
      (column) =>
        columns.includes(column) &&
        new RegExp(column, "i").test(message),
    );
    if (!missing) return result;

    columns = withoutColumn(columns, missing);
    result = await build(columns);
  }

  return result;
}

export async function getAnnouncements(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AnnouncementRow[]> {
  const { data, error } = await selectAnnouncements((columns) =>
    supabase
      .from("announcements")
      .select(columns)
      .eq("church_id", churchId)
      .order("start_at", { ascending: false, nullsFirst: false }),
  );

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) =>
    mapAnnouncementRow(row),
  );
}

export async function getAnnouncement(
  supabase: SupabaseClient,
  churchId: string,
  id: string,
): Promise<AnnouncementRow | null> {
  const { data, error } = await selectAnnouncements((columns) =>
    supabase
      .from("announcements")
      .select(columns)
      .eq("church_id", churchId)
      .eq("id", id)
      .maybeSingle(),
  );

  if (error || !data) return null;

  return mapAnnouncementRow(data as Record<string, unknown>);
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
  const { data, error } = await selectAnnouncements((columns) =>
    supabase
      .from("announcements")
      .select(columns)
      .eq("church_id", churchId)
      .eq("status", "published")
      .order("published_at", { ascending: false }),
  );

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) =>
    mapAnnouncementRow(row),
  );
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
    all_day: Boolean(row.all_day),
    event_location: (row.event_location as string | null) ?? null,
    is_ready: Boolean(row.is_ready),
    push_to_app: Boolean(row.push_to_app),
    push_to_facebook: Boolean(row.push_to_facebook),
    push_to_team: Boolean(row.push_to_team),
    status: (row.status as string) ?? "pending",
    google_event_id: (row.google_event_id as string | null) ?? null,
    google_calendar_id: (row.google_calendar_id as string | null) ?? null,
    facebook_post_id: (row.facebook_post_id as string | null) ?? null,
    facebook_scheduled_publish_time:
      (row.facebook_scheduled_publish_time as string | null) ?? null,
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

/**
 * The zone a date-only event must be read in.
 *
 * Google and iCloud both send an all-day event as a bare `YYYY-MM-DD`, which
 * becomes midnight UTC once it is an instant. Rendering that in a church's own
 * zone walks it backwards — a Saturday all-day event prints as Friday evening
 * anywhere west of Greenwich — so all-day dates are always read back in UTC,
 * exactly where the calendar put them.
 */
const ALL_DAY_ZONE = "UTC";

/**
 * `timeZone` matters on the server: scheduled jobs run in UTC, so a weekly
 * email rendered without it would show every event in the wrong zone. Omit it
 * in the browser to use the viewer's own locale/timezone.
 *
 * `allDay` prints the date alone: a date-only event has no time anyone chose,
 * and the midnight-UTC instant standing in for one is not worth showing.
 */
export function formatDateTimeRange(
  startAt: string,
  endAt: string | null,
  timeZone?: string | null,
  allDay?: boolean,
): string {
  if (allDay) {
    const dateStr = new Date(startAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: ALL_DAY_ZONE,
    });
    return `${dateStr} · all day`;
  }

  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  };

  const start = new Date(startAt);
  const startStr = start.toLocaleString(undefined, options);

  if (!endAt) return `${startStr} – ongoing`;

  const end = new Date(endAt);
  const endStr = end.toLocaleString(undefined, options);

  return `${startStr} – ${endStr}`;
}

function withOrdinal(day: number): string {
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

type EventTimeParts = {
  month: string;
  day: number;
  hour: string;
  minute: string;
  meridiem: string;
};

/**
 * One instant broken into the pieces an announcement says out loud. The locale
 * is pinned rather than left to the host: this renders on a cron worker, and
 * the ordinal is the point.
 */
function eventTimeParts(
  at: string,
  timeZone?: string | null,
): EventTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(new Date(at));

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const day = Number(value("day"));
  const meridiem = value("dayPeriod").replace(/\s| /g, "").toUpperCase();

  return {
    month: value("month"),
    day,
    hour: value("hour"),
    minute: value("minute"),
    meridiem,
  };
}

/**
 * When an event happens, written the way an announcement reads out loud:
 * "August 4th 4:00PM".
 *
 * Start time only. The end is deliberately not printed: a weekly email listing
 * a dozen events reads as a wall of clock times when every line carries a
 * span, and the thing a congregation scans for is when to show up. The end
 * time still lives on the announcement itself for anyone who opens it.
 *
 * An all-day event prints as a bare date. `startAt` is then midnight UTC
 * standing in for a time nobody chose, so it is read back in UTC — see
 * `ALL_DAY_ZONE` — and no time is shown at all.
 */
export function formatEventWhen(
  startAt: string,
  _endAt?: string | null,
  timeZone?: string | null,
  allDay?: boolean,
): string {
  if (allDay) {
    const date = eventTimeParts(startAt, ALL_DAY_ZONE);
    return `${date.month} ${withOrdinal(date.day)} (all day)`;
  }

  const start = eventTimeParts(startAt, timeZone);
  return `${start.month} ${withOrdinal(start.day)} ${start.hour}:${start.minute}${start.meridiem}`;
}

/**
 * Separate date and time lines for Facebook announcement graphics.
 * Time is start-only (e.g. "6:00 PM"), not a range — keeps the flyer clean.
 *
 * `timeZone` is required for correctness on the server: flyers render on
 * Vercel in UTC, and without it an evening event prints the next day's date.
 *
 * An all-day event has no time to print, and its date is read in UTC where the
 * calendar wrote it — rendering that midnight in the church's own zone put the
 * previous day on the flyer.
 */
export function formatEventGraphicDetails(
  startAt: string,
  _endAt?: string | null,
  timeZone?: string | null,
  allDay?: boolean,
): { dateLine: string; timeLine: string } {
  const start = new Date(startAt);
  const zone = allDay ? { timeZone: ALL_DAY_ZONE } : timeZone ? { timeZone } : {};

  const dateLine = start
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
      ...zone,
    })
    .toUpperCase();

  if (allDay) return { dateLine, timeLine: "ALL DAY" };

  const timeLine = start
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...zone,
    })
    .toUpperCase();

  return { dateLine, timeLine };
}

/**
 * The date as an AI writer needs to be told it: weekday and year spelled out.
 *
 * A caption may name the day ("this Saturday"), and a model handed "Aug 4"
 * with no weekday and no year works one out from whatever calendar its
 * training left it with — August 4th is a Tuesday in 2026 and a Monday in
 * 2025. Nothing downstream can catch that, so the weekday is stated rather
 * than inferred.
 */
export function formatEventWhenForPrompt(
  startAt: string,
  endAt: string | null,
  timeZone?: string | null,
  allDay?: boolean,
): string {
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: allDay ? ALL_DAY_ZONE : timeZone ?? undefined,
  };
  const start = new Date(startAt);
  const dateStr = start.toLocaleDateString("en-US", dateOptions);

  if (allDay) return `${dateStr} (all day — no set time)`;

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone ?? undefined,
  };
  const startTime = start.toLocaleTimeString("en-US", timeOptions);

  if (!endAt) return `${dateStr} at ${startTime}`;

  const endTime = new Date(endAt).toLocaleTimeString("en-US", timeOptions);
  return `${dateStr} from ${startTime} to ${endTime}`;
}

export function buildFacebookPostMessage(input: {
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  notes?: string;
  /** Church IANA timezone — required on the server, where local time is UTC. */
  timeZone?: string | null;
  allDay?: boolean;
}): string {
  const when = formatDateTimeRange(
    input.startAt,
    input.endAt,
    input.timeZone,
    input.allDay,
  );
  const lines = [input.title, when];
  if (input.location) lines.push(`📍 ${input.location}`);
  if (input.notes?.trim()) lines.push("", input.notes.trim());
  return lines.join("\n");
}
