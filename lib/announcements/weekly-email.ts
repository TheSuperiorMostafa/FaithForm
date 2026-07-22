import type { SupabaseClient } from "@supabase/supabase-js";

import {
  renderAnnouncementEmail,
  type WeeklyEmailEvent,
} from "@/lib/email/announcement-template";
import { listCalendarEventsInRange } from "@/lib/integrations/google-calendar";
import { createGmailDraft } from "@/lib/integrations/gmail";
import { hasIntegration } from "@/lib/integrations/tokens";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import type { AnnouncementRow } from "@/lib/queries/announcements";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMondayWeekWindow } from "@/lib/utils/calendar";

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

export function buildWeeklyAnnouncementQueue(
  events: CalendarEventPreview[],
  publishedByGoogleId: Record<string, AnnouncementRow>,
  now: Date = new Date(),
): WeeklyQueueItem[] {
  const { weekStartISO, weekEndISO } = getMondayWeekWindow(now);
  const weekStartMs = new Date(weekStartISO).getTime();
  const weekEndMs = new Date(weekEndISO).getTime();

  return events
    .filter((event) => {
      const startMs = new Date(event.startAt).getTime();
      return startMs >= weekStartMs && startMs <= weekEndMs;
    })
    .sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    )
    .map((event) => {
      const publishedRow = publishedByGoogleId[event.googleEventId];
      const published = Boolean(publishedRow);
      const passed = eventHasPassed(event, now);

      let includeInWeeklyEmail = !passed;
      if (publishedRow) {
        includeInWeeklyEmail = publishedRow.push_to_team && !passed;
      }

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
        notes: published?.body?.trim() || undefined,
      };
    });
}

export type WeeklyDraftResult =
  | {
      ok: true;
      draftId: string;
      draftUrl: string;
      eventCount: number;
      skipped: boolean;
      reason?: string;
    }
  | { ok: false; error: string; skipped?: boolean; reason?: string };

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
  const week = getMondayWeekWindow(now);

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
      error: "A Gmail draft for this week was already created.",
    };
  }

  const googleConnected = await hasIntegration(churchId, "google", supabase);
  if (!googleConnected) {
    return {
      ok: false,
      error: "Google is not connected for this church.",
    };
  }

  const { data: church } = await supabase
    .from("churches")
    .select("name")
    .eq("id", churchId)
    .maybeSingle();

  const churchName = (church?.name as string | undefined)?.trim() || "Your church";

  const events = await listCalendarEventsInRange(
    churchId,
    week.weekStartISO,
    week.weekEndISO,
    supabase,
  );

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
  );
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
        },
        now,
      ),
  );

  if (emailEvents.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: "no_upcoming_events",
      error: "No upcoming events remain this week.",
    };
  }

  const rendered = renderAnnouncementEmail({
    subjectTemplate: settings.subject,
    bodyTemplate: settings.body,
    weekLabel: week.weekLabel,
    churchName,
    events: emailEvents,
  });

  const draft = await createGmailDraft(
    churchId,
    {
      to: settings.to ?? undefined,
      subject: rendered.subject,
      bodyHtml: rendered.bodyHtml,
    },
    supabase,
  );

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
    eventCount: emailEvents.length,
    skipped: false,
  };
}

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

  // Only run automatic drafts on Mondays (local server time).
  if (!options?.force && now.getDay() !== 1) {
    return { processed: 0, created: 0, skipped: 0, errors: [] };
  }

  const { data: integrations, error } = await supabase
    .from("church_integrations")
    .select("church_id")
    .eq("provider", "google");

  if (error || !integrations?.length) {
    return { processed: 0, created: 0, skipped: 0, errors: [] };
  }

  let created = 0;
  let skipped = 0;
  const errors: Array<{ churchId: string; error: string }> = [];

  for (const row of integrations) {
    const churchId = row.church_id as string;
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
  }

  return {
    processed: integrations.length,
    created,
    skipped,
    errors,
  };
}
