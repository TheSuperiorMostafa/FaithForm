import type { SupabaseClient } from "@supabase/supabase-js";

import {
  renderAnnouncementEmail,
  type WeeklyEmailEvent,
} from "@/lib/email/announcement-template";
import { loadAttachmentsForSend } from "@/lib/announcements/attachments";
import {
  createWeeklyEmailDraft,
  NO_WEEKLY_EMAIL_CHANNEL_MESSAGE,
  resolveWeeklyEmailChannel,
  selectWeeklyDraftChurchIds,
  WEEKLY_EMAIL_SWITCHED_OFF_MESSAGE,
  type WeeklyEmailChannel,
} from "@/lib/announcements/email-delivery";
import { listEmailQueue } from "@/lib/announcements/email-queue";
import {
  churchIdsWithFeatureEmailOff,
  isChurchFeatureEmailEnabled,
} from "@/lib/features/access";
import { listChurchCalendarEvents } from "@/lib/integrations/calendar";
import { ICloudMailError } from "@/lib/integrations/icloud-mail";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import type { AnnouncementRow } from "@/lib/queries/announcements";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getMondayWeekWindowInTimeZone,
  getZonedWeekday,
} from "@/lib/utils/calendar";

/**
 * How far ahead an event can be and still be added to this week's email.
 * Comfortably past the "let people know a fortnight early" case.
 */
export const QUEUE_HORIZON_DAYS = 56;

export type WeeklyQueueItem = CalendarEventPreview & {
  announcementId?: string;
  published: boolean;
  includeInWeeklyEmail: boolean;
  skippedReason?: "past";
};

function eventHasPassed(event: CalendarEventPreview, now: Date): boolean {
  const end = event.endAt ? new Date(event.endAt) : new Date(event.startAt);
  return end.getTime() < now.getTime();
}

function eventStartsInFuture(event: CalendarEventPreview, now: Date): boolean {
  return new Date(event.startAt).getTime() >= now.getTime();
}

/**
 * The events a church can put in this week's email.
 *
 * Deliberately not limited to the current week: an event a fortnight out is
 * exactly the sort of thing that needs announcing now, so anything from this
 * week's Monday onward is offered, and `queuedEventIds` says which have
 * actually been added.
 */
export function buildWeeklyAnnouncementQueue(
  events: CalendarEventPreview[],
  publishedByGoogleId: Record<string, AnnouncementRow>,
  now: Date = new Date(),
  timeZone?: string | null,
  queuedEventIds: Set<string> = new Set(),
): WeeklyQueueItem[] {
  const { weekStartISO } = getMondayWeekWindowInTimeZone(now, timeZone);
  const weekStartMs = new Date(weekStartISO).getTime();

  return events
    .filter((event) => new Date(event.startAt).getTime() >= weekStartMs)
    .sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    )
    .map((event) => {
      const publishedRow = publishedByGoogleId[event.googleEventId];
      const published = Boolean(publishedRow);
      const passed = eventHasPassed(event, now);

      // Membership of the email is now an explicit choice, not a side effect of
      // the date. `push_to_team` still counts so events queued the old way — by
      // verifying them with the team toggle on — are not silently dropped.
      const includeInWeeklyEmail =
        !passed &&
        (queuedEventIds.has(event.googleEventId) ||
          Boolean(publishedRow?.push_to_team));

      return {
        ...event,
        announcementId: publishedRow?.id,
        published,
        includeInWeeklyEmail,
        skippedReason: passed ? "past" : undefined,
      };
    });
}

export function weeklyQueueToEmailEvents(
  queue: WeeklyQueueItem[],
  publishedByGoogleId: Record<string, AnnouncementRow>,
): WeeklyEmailEvent[] {
  return queue
    .filter((item) => item.includeInWeeklyEmail)
    .map((item) => {
      const published = publishedByGoogleId[item.googleEventId];
      return {
        title: published?.title ?? item.title,
        location: published?.event_location ?? item.location,
        startAt: published?.start_at ?? item.startAt,
        endAt: published?.end_at ?? item.endAt,
        // Whether it is an all-day entry is the calendar's to say, not the
        // announcement row's: the row stores only the instants.
        allDay: item.allDay,
        notes: published?.body?.trim() || undefined,
      };
    });
}

export type WeeklyDraftResult =
  | {
      ok: true;
      draftId: string;
      draftUrl: string;
      /** The mailbox the draft was made in. */
      provider: WeeklyEmailChannel;
      eventCount: number;
      skipped: boolean;
      reason?: string;
    }
  | { ok: false; error: string; skipped?: boolean; reason?: string };

/**
 * What a church is told when its mailbox would not take the draft.
 *
 * Only the message is ever read from a Gmail error: googleapis errors carry
 * the request they failed on, OAuth bearer token included.
 */
function draftFailureMessage(channel: WeeklyEmailChannel, err: unknown): string {
  if (err instanceof ICloudMailError) return err.message;

  const detail = err instanceof Error ? err.message : "";
  console.error(`[weekly-email] ${channel} draft failed:`, detail || err);

  if (channel === "icloud") {
    return "iCloud Mail wouldn't save this week's email. Try again in a moment.";
  }
  return detail
    ? `Google email wouldn't save this week's draft. ${detail}`
    : "Google email wouldn't save this week's draft. Try again in a moment.";
}

/**
 * Makes this week's announcement email as a draft, in Gmail or iCloud Mail.
 *
 * The name is from when Gmail was the only mailbox, and callers know it by
 * that name. Which mailbox it uses is `resolveWeeklyEmailChannel`'s call.
 */
export async function createWeeklyAnnouncementGmailDraft(
  churchId: string,
  options?: {
    force?: boolean;
    now?: Date;
    supabase?: SupabaseClient;
  },
): Promise<WeeklyDraftResult> {
  const supabase = options?.supabase ?? createAdminClient();
  const now = options?.now ?? new Date();

  // A platform admin can switch a church's announcement email off without
  // switching announcements off. That stops the email being made by hand as
  // well as by the Monday run.
  if (!(await isChurchFeatureEmailEnabled(churchId, "announcements"))) {
    return {
      ok: false,
      skipped: true,
      reason: "email_switched_off",
      error: WEEKLY_EMAIL_SWITCHED_OFF_MESSAGE,
    };
  }

  const { data: church } = await supabase
    .from("churches")
    .select("name, timezone")
    .eq("id", churchId)
    .maybeSingle();

  const churchName = (church?.name as string | undefined)?.trim() || "Your church";
  const timeZone = (church?.timezone as string | undefined) ?? null;

  // The week (and its idempotency key) is anchored to the church's timezone,
  // not the server's — cron runs execute in UTC.
  const week = getMondayWeekWindowInTimeZone(now, timeZone);

  const settings = await getAnnouncementEmailSettings(churchId, supabase);
  if (!settings.weeklyEmailEnabled) {
    return {
      ok: false,
      skipped: true,
      reason: "weekly_email_disabled",
      error: "Weekly announcement email is disabled in settings.",
    };
  }

  if (
    !options?.force &&
    settings.lastWeeklyDraftWeekStart === week.weekStartKey
  ) {
    return {
      ok: false,
      skipped: true,
      reason: "already_created",
      error: "This week's email has already been created.",
    };
  }

  const channel = await resolveWeeklyEmailChannel(churchId, supabase);
  if (!channel) {
    return { ok: false, error: NO_WEEKLY_EMAIL_CHANNEL_MESSAGE };
  }

  // Look well past the current week: the queue can hold an event a fortnight
  // out, and the draft has to be able to find it on the calendar.
  const horizonEnd = new Date(
    new Date(week.weekStartISO).getTime() + QUEUE_HORIZON_DAYS * 86_400_000,
  ).toISOString();

  // The draft lands in one mailbox, but the events in it come from every
  // calendar the church has linked.
  const [calendar, queued] = await Promise.all([
    listChurchCalendarEvents(churchId, week.weekStartISO, horizonEnd, supabase),
    listEmailQueue(churchId, week.weekStartKey, supabase),
  ]);
  const events = calendar.events;

  const queuedEventIds = new Set(queued.map((item) => item.googleEventId));

  const { data: publishedRows } = await supabase
    .from("announcements")
    .select(
      "id, title, body, start_at, end_at, event_location, push_to_team, google_event_id, status",
    )
    .eq("church_id", churchId)
    .eq("status", "published")
    .not("google_event_id", "is", null);

  const publishedByGoogleId: Record<string, AnnouncementRow> = {};
  for (const row of publishedRows ?? []) {
    const gid = row.google_event_id as string;
    if (!gid) continue;
    publishedByGoogleId[gid] = {
      id: row.id as string,
      church_id: churchId,
      title: (row.title as string) ?? "",
      body: (row.body as string) ?? "",
      start_at: row.start_at as string,
      end_at: (row.end_at as string | null) ?? null,
      event_location: (row.event_location as string | null) ?? null,
      is_ready: true,
      push_to_app: false,
      push_to_facebook: false,
      push_to_team: Boolean(row.push_to_team),
      status: "published",
      google_event_id: gid,
      google_calendar_id: null,
      facebook_post_id: null,
      gmail_draft_id: null,
      published_at: null,
      last_publish_error: null,
      created_at: "",
      updated_at: "",
    };
  }

  const queue = buildWeeklyAnnouncementQueue(
    events,
    publishedByGoogleId,
    now,
    timeZone,
    queuedEventIds,
  );

  // An event that has already finished is dropped, however it got queued. Any
  // other still-to-come event stays in, whatever week it falls in.
  const emailEvents = weeklyQueueToEmailEvents(queue, publishedByGoogleId).filter(
    (event) =>
      eventStartsInFuture(
        {
          googleEventId: "",
          calendarId: "",
          title: event.title,
          location: event.location,
          startAt: event.startAt,
          endAt: event.endAt,
          allDay: event.allDay,
        },
        now,
      ),
  );

  if (emailEvents.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: "no_queued_events",
      error: "Nothing has been added to this week's email.",
    };
  }

  const rendered = renderAnnouncementEmail({
    subjectTemplate: settings.subject,
    bodyTemplate: settings.body,
    weekLabel: week.weekLabel,
    churchName,
    events: emailEvents,
    timeZone,
  });

  const attachments = await loadAttachmentsForSend(churchId, supabase);

  let draft: { draftId: string; draftUrl: string };
  try {
    draft = await createWeeklyEmailDraft(
      channel,
      churchId,
      {
        to: settings.to ?? undefined,
        subject: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        attachments,
      },
      supabase,
    );
  } catch (err) {
    return { ok: false, error: draftFailureMessage(channel, err) };
  }

  const { markWeeklyAnnouncementDraftCreated } = await import(
    "@/lib/queries/announcement-email-settings"
  );
  await markWeeklyAnnouncementDraftCreated(
    churchId,
    week.weekStartKey,
    draft.draftId,
    supabase,
  );

  return {
    ok: true,
    draftId: draft.draftId,
    draftUrl: draft.draftUrl,
    provider: channel,
    eventCount: emailEvents.length,
    skipped: false,
  };
}

/**
 * Local weekdays on which an automatic draft may be created (Mon–Wed).
 *
 * Monday is the intended day. Tuesday and Wednesday act as a catch-up window
 * so a failed run — an expired Google token, iCloud Mail not answering, a
 * deploy, a cron blip — still produces that week's draft instead of silently
 * skipping the week. The per-church `weekStartKey` guard keeps it to one
 * draft per week regardless.
 */
const AUTO_DRAFT_LOCAL_WEEKDAYS = new Set([1, 2, 3]);

export async function runWeeklyAnnouncementDraftsForAllChurches(
  options?: { force?: boolean; now?: Date },
): Promise<{
  processed: number;
  created: number;
  skipped: number;
  errors: Array<{ churchId: string; error: string }>;
}> {
  const supabase = createAdminClient();
  const now = options?.now ?? new Date();

  // Metadata only, never tokens: whether each connection still works is
  // settled church by church when its draft is made.
  const { data: integrations, error } = await supabase
    .from("church_integrations")
    .select("church_id, provider, metadata")
    .in("provider", ["google", "apple"]);

  if (error || !integrations?.length) {
    return { processed: 0, created: 0, skipped: 0, errors: [] };
  }

  const churchIds = selectWeeklyDraftChurchIds(
    integrations.map((row) => ({
      churchId: row.church_id as string,
      provider: row.provider as string,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    })),
  );

  if (churchIds.length === 0) {
    return { processed: 0, created: 0, skipped: 0, errors: [] };
  }

  const { data: churches } = await supabase
    .from("churches")
    .select("id, timezone")
    .in("id", churchIds);

  const timezoneByChurch = new Map<string, string | null>(
    (churches ?? []).map((row) => [
      row.id as string,
      (row.timezone as string | null) ?? null,
    ]),
  );

  // Churches that have the announcements feature switched off by a platform
  // admin should not receive automated drafts.
  const disabledChurchIds = new Set<string>();
  const { data: featureRows, error: featureError } = await supabase
    .from("church_features")
    .select("church_id, enabled")
    .eq("feature_key", "announcements")
    .in("church_id", churchIds);

  if (featureError) {
    if (!/church_features/i.test(featureError.message)) {
      console.error("weekly draft feature flags:", featureError.message);
    }
  } else {
    for (const row of featureRows ?? []) {
      if (!row.enabled) disabledChurchIds.add(row.church_id as string);
    }
  }

  // And churches that keep announcements but have had its email switched off.
  for (const churchId of await churchIdsWithFeatureEmailOff("announcements")) {
    disabledChurchIds.add(churchId);
  }

  let created = 0;
  let skipped = 0;
  const errors: Array<{ churchId: string; error: string }> = [];

  for (const churchId of churchIds) {
    if (disabledChurchIds.has(churchId)) {
      skipped++;
      continue;
    }

    const timeZone = timezoneByChurch.get(churchId) ?? null;

    // Evaluated per church: the cron fires once daily in UTC, but each church
    // gets its draft on its own local Monday.
    if (
      !options?.force &&
      !AUTO_DRAFT_LOCAL_WEEKDAYS.has(getZonedWeekday(now, timeZone))
    ) {
      skipped++;
      continue;
    }

    // One church's failure must not cost every church after it its email.
    try {
      const result = await createWeeklyAnnouncementGmailDraft(churchId, {
        force: options?.force,
        now,
        supabase,
      });

      if (result.ok) {
        created++;
      } else if (result.skipped) {
        skipped++;
      } else {
        errors.push({ churchId, error: result.error });
      }
    } catch (err) {
      errors.push({
        churchId,
        error: err instanceof Error ? err.message : "Could not create the weekly email.",
      });
    }
  }

  return {
    processed: churchIds.length,
    created,
    skipped,
    errors,
  };
}
