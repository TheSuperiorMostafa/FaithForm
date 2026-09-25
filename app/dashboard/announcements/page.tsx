import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Megaphone } from "lucide-react";

import {
  AnnouncementsComposerProvider,
  NewAnnouncementButton,
} from "@/components/announcements/composer-context";
import type { ComposerSettings } from "@/components/announcements/announcement-composer";
import {
  CalendarSuggestions,
  type CalendarSuggestion,
} from "@/components/announcements/calendar-suggestions";
import { MonthCalendar } from "@/components/announcements/month-calendar";
import { PostedAnnouncements } from "@/components/announcements/posted-announcements";
import {
  WeeklyEmailCard,
  type WeeklyEmailCandidate,
  type WeeklyEmailEntry,
} from "@/components/announcements/weekly-email-card";
import {
  CalendarSectionSkeleton,
  CalendarSuggestionsSkeleton,
  PostedSectionSkeleton,
  WeeklyEmailCardSkeleton,
} from "@/components/announcements/announcements-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { describeWhen, type PostedItem } from "@/lib/announcements/composer";
import {
  getWeeklyEmailAvailability,
  weeklyEmailDraftLinkFor,
} from "@/lib/announcements/email-delivery";
import { listEmailQueue } from "@/lib/announcements/email-queue";
import {
  listTakenDownAnnouncements,
  listUndatedAnnouncementIds,
} from "@/lib/announcements/standalone";
import {
  buildWeeklyAnnouncementQueue,
  listStandaloneEmailRows,
  QUEUE_HORIZON_DAYS,
  standaloneBelongsInWeeklyEmail,
} from "@/lib/announcements/weekly-email";
import { getChurchAuth } from "@/lib/auth/church";
import { isAppleEventId, isReadOnlyAppleEventId } from "@/lib/integrations/apple-calendar";
import { listChurchCalendarEvents } from "@/lib/integrations/calendar";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import {
  getPublishedAnnouncements,
  type AnnouncementRow,
} from "@/lib/queries/announcements";
import { createClient } from "@/lib/supabase/server";
import { listEventAttendanceSettings } from "@/lib/attendance/v2/event-attendance";
import { getChurchAttendancePolicy } from "@/lib/attendance/v2/setup";
import { listCampuses } from "@/lib/faithform/campuses";
import {
  getMondayWeekWindowInTimeZone,
  getMonthWindowForDate,
} from "@/lib/utils/calendar";

export const dynamic = "force-dynamic";

/** How far ahead "From your calendar" looks for events to announce. */
const SUGGESTION_DAYS = 14;
const DAY_MS = 86_400_000;

type CalendarRead = { events: CalendarEventPreview[]; errors: string[] };

export default async function AnnouncementsPage() {
  const supabase = createClient();
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const churchId = auth.churchId;

  if (!churchId) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title="Announcements" icon={Megaphone} />
        <EmptyState
          icon={Megaphone}
          title="Your account isn't connected to a church yet"
          description="Ask your church admin for an invite, then come back to post announcements."
        />
      </div>
    );
  }

  const now = new Date();
  const churchTimeZone = auth.churchTimezone ?? null;
  const week = getMondayWeekWindowInTimeZone(now, churchTimeZone);
  const { year, monthIndex, startISO, endISO } = getMonthWindowForDate(now);

  const [integrationStatus, weeklyEmail] = await Promise.all([
    getIntegrationStatus(churchId, supabase),
    getWeeklyEmailAvailability(churchId, supabase),
  ]);
  const googleConnected = integrationStatus.google.connected;
  const appleConnected = integrationStatus.apple.connected;
  const calendarConnected = googleConnected || appleConnected;
  // A calendar connected through a public iCloud link can be read, not
  // written, so it cannot take a new event.
  const canCreateEvents =
    googleConnected || (appleConnected && !integrationStatus.apple.readOnly);
  const connected = { google: googleConnected, apple: appleConnected };

  const settings: ComposerSettings = {
    churchId,
    churchTimeZone,
    isAdmin: auth.isAdmin,
    facebookConnected: integrationStatus.facebook.connected,
    emailAvailable: weeklyEmail.available,
    calendarConnected,
    canCreateEvents,
  };

  // Started once and shared by the sections below, each under its own
  // Suspense boundary, so a slow calendar never holds back the posted list.
  const upcomingPromise: Promise<CalendarRead> = calendarConnected
    ? listChurchCalendarEvents(
        churchId,
        week.weekStartISO,
        new Date(new Date(week.weekStartISO).getTime() + QUEUE_HORIZON_DAYS * DAY_MS).toISOString(),
        supabase,
        connected,
      )
    : Promise.resolve({ events: [], errors: [] });
  const publishedPromise = getPublishedAnnouncements(supabase, churchId);
  const queuedPromise = listEmailQueue(churchId, week.weekStartKey, supabase);

  return (
    <AnnouncementsComposerProvider settings={settings}>
      <div className="flex w-full flex-col gap-8">
        <PageHeader
          title="Announcements"
          description="Tell your church what's happening, in the app, by email and on Facebook."
          icon={Megaphone}
          action={<NewAnnouncementButton />}
        />

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-8">
            <Suspense fallback={<CalendarSuggestionsSkeleton calendarConnected={calendarConnected} />}>
              <SuggestionsSection
                now={now}
                calendarConnected={calendarConnected}
                timeZone={churchTimeZone}
                upcomingPromise={upcomingPromise}
                publishedPromise={publishedPromise}
              />
            </Suspense>

            <Suspense fallback={<PostedSectionSkeleton />}>
              <PostedSection
                churchId={churchId}
                now={now}
                timeZone={churchTimeZone}
                isAdmin={auth.isAdmin}
                publishedPromise={publishedPromise}
                queuedPromise={queuedPromise}
              />
            </Suspense>
          </div>

          <div className="flex min-w-0 flex-col gap-8 xl:sticky xl:top-4 xl:self-start">
            <Suspense fallback={<WeeklyEmailCardSkeleton />}>
              <WeeklyEmailSection
                churchId={churchId}
                now={now}
                timeZone={churchTimeZone}
                week={week}
                isAdmin={auth.isAdmin}
                emailAvailable={weeklyEmail.available}
                emailSwitchedOff={weeklyEmail.switchedOff}
                emailChannel={weeklyEmail.channel}
                upcomingPromise={upcomingPromise}
                publishedPromise={publishedPromise}
                queuedPromise={queuedPromise}
              />
            </Suspense>
          </div>
        </div>

        {calendarConnected && (
          <Suspense fallback={<CalendarSectionSkeleton />}>
            <CalendarSection
              churchId={churchId}
              year={year}
              monthIndex={monthIndex}
              startISO={startISO}
              endISO={endISO}
              connected={connected}
              canCreateEvents={canCreateEvents}
              isAdmin={auth.isAdmin}
              timeZone={churchTimeZone}
              publishedPromise={publishedPromise}
              queuedPromise={queuedPromise}
            />
          </Suspense>
        )}
      </div>
    </AnnouncementsComposerProvider>
  );
}

type WeekWindow = ReturnType<typeof getMondayWeekWindowInTimeZone>;
type PublishedPromise = Promise<AnnouncementRow[]>;
type QueuedPromise = ReturnType<typeof listEmailQueue>;

function byGoogleId(rows: AnnouncementRow[]): Record<string, AnnouncementRow> {
  return Object.fromEntries(
    rows.filter((row) => row.google_event_id).map((row) => [row.google_event_id!, row]),
  );
}

function eventIsOver(event: CalendarEventPreview, now: Date): boolean {
  const end = event.endAt ? Date.parse(event.endAt) : Date.parse(event.startAt);
  return end < now.getTime();
}

async function SuggestionsSection({
  now,
  calendarConnected,
  timeZone,
  upcomingPromise,
  publishedPromise,
}: {
  now: Date;
  calendarConnected: boolean;
  timeZone: string | null;
  upcomingPromise: Promise<CalendarRead>;
  publishedPromise: PublishedPromise;
}) {
  const [upcoming, published] = await Promise.all([upcomingPromise, publishedPromise]);
  const posted = byGoogleId(published);
  const until = now.getTime() + SUGGESTION_DAYS * DAY_MS;

  const events: CalendarSuggestion[] = upcoming.events
    .filter((event) => !posted[event.googleEventId])
    .filter((event) => !eventIsOver(event, now))
    .filter((event) => Date.parse(event.startAt) <= until)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

  if (upcoming.errors.length > 0) {
    console.error("[announcements] calendar read:", upcoming.errors.join(" "));
  }

  return (
    <CalendarSuggestions
      events={events}
      calendarConnected={calendarConnected}
      calendarProblem={upcoming.errors.length > 0}
      timeZone={timeZone}
    />
  );
}

async function PostedSection({
  churchId,
  now,
  timeZone,
  isAdmin,
  publishedPromise,
  queuedPromise,
}: {
  churchId: string;
  now: Date;
  timeZone: string | null;
  isAdmin: boolean;
  publishedPromise: PublishedPromise;
  queuedPromise: QueuedPromise;
}) {
  const supabase = createClient();
  const [published, queued, undatedIds, takenDown] = await Promise.all([
    publishedPromise,
    queuedPromise,
    listUndatedAnnouncementIds(supabase, churchId),
    listTakenDownAnnouncements(supabase, churchId),
  ]);
  const queuedIds = new Set(queued.map((item) => item.googleEventId));

  const items: PostedItem[] = published.map((announcement) => {
    const eventId = announcement.google_event_id;
    return {
      announcement,
      undated: undatedIds.has(announcement.id),
      queuedForWeeklyEmail: eventId ? queuedIds.has(eventId) : false,
      calendar: eventId
        ? {
            source: isAppleEventId(eventId) ? "apple" : "google",
            readOnly: isReadOnlyAppleEventId(eventId),
          }
        : null,
    };
  });

  return (
    <PostedAnnouncements
      items={items}
      takenDown={takenDown}
      timeZone={timeZone}
      isAdmin={isAdmin}
      now={now.getTime()}
    />
  );
}

async function WeeklyEmailSection({
  churchId,
  now,
  timeZone,
  week,
  isAdmin,
  emailAvailable,
  emailSwitchedOff,
  emailChannel,
  upcomingPromise,
  publishedPromise,
  queuedPromise,
}: {
  churchId: string;
  now: Date;
  timeZone: string | null;
  week: WeekWindow;
  isAdmin: boolean;
  emailAvailable: boolean;
  emailSwitchedOff: boolean;
  emailChannel: "gmail" | "icloud" | null;
  upcomingPromise: Promise<CalendarRead>;
  publishedPromise: PublishedPromise;
  queuedPromise: QueuedPromise;
}) {
  const supabase = createClient();
  const [upcoming, published, queued, standalone, emailSettings] = await Promise.all([
    upcomingPromise,
    publishedPromise,
    queuedPromise,
    listStandaloneEmailRows(churchId, supabase),
    getAnnouncementEmailSettings(churchId, supabase),
  ]);

  const posted = byGoogleId(published);
  const queuedById = new Map(queued.map((item) => [item.googleEventId, item]));
  // The same rules the Monday draft uses, so the count here is what goes out.
  const queue = buildWeeklyAnnouncementQueue(
    upcoming.events,
    posted,
    now,
    timeZone,
    new Set(queuedById.keys()),
  );

  const entries: WeeklyEmailEntry[] = [];
  const candidates: WeeklyEmailCandidate[] = [];

  for (const item of queue) {
    if (item.skippedReason) continue;
    const row = posted[item.googleEventId];
    const when = describeWhen(
      {
        startAt: row?.start_at ?? item.startAt,
        endAt: row?.end_at ?? item.endAt,
        allDay: Boolean(item.allDay),
      },
      timeZone,
    );
    if (item.includeInWeeklyEmail) {
      if (Date.parse(row?.start_at ?? item.startAt) < now.getTime()) continue;
      const queuedItem = queuedById.get(item.googleEventId);
      entries.push({
        key: item.googleEventId,
        title: row?.title ?? item.title,
        when,
        queuedEvent:
          queuedItem && !row?.push_to_team
            ? { googleEventId: item.googleEventId, calendarId: queuedItem.calendarId ?? item.calendarId }
            : undefined,
      });
    } else if (candidates.length < 8) {
      candidates.push({
        googleEventId: item.googleEventId,
        calendarId: item.calendarId ?? null,
        title: item.title,
        when,
      });
    }
  }

  standalone
    .filter((row) => standaloneBelongsInWeeklyEmail(row, now, week.weekStartISO))
    .forEach((row, index) => {
      entries.push({
        key: `standalone-${index}`,
        title: row.title,
        when: describeWhen(
          {
            startAt: row.start_at,
            endAt: row.end_at,
            allDay: row.all_day,
            undated: row.undated,
            postedAt: row.published_at,
          },
          timeZone,
        ),
      });
    });

  const draftCreatedThisWeek = emailSettings.lastWeeklyDraftWeekStart === week.weekStartKey;

  return (
    <WeeklyEmailCard
      available={emailAvailable}
      switchedOff={emailSwitchedOff}
      draftLink={weeklyEmailDraftLinkFor({
        draftIdThisWeek: draftCreatedThisWeek ? emailSettings.lastWeeklyDraftId : null,
        channel: emailChannel,
      })}
      weekLabel={week.weekLabel}
      draftCreatedThisWeek={draftCreatedThisWeek}
      isAdmin={isAdmin}
      entries={entries}
      candidates={candidates}
    />
  );
}

async function CalendarSection({
  churchId,
  year,
  monthIndex,
  startISO,
  endISO,
  connected,
  canCreateEvents,
  isAdmin,
  timeZone,
  publishedPromise,
  queuedPromise,
}: {
  churchId: string;
  year: number;
  monthIndex: number;
  startISO: string;
  endISO: string;
  connected: { google: boolean; apple: boolean };
  canCreateEvents: boolean;
  isAdmin: boolean;
  timeZone: string | null;
  publishedPromise: PublishedPromise;
  queuedPromise: QueuedPromise;
}) {
  const supabase = createClient();
  const [published, month, campuses, attendancePolicy, queuedItems] = await Promise.all([
    publishedPromise,
    listChurchCalendarEvents(churchId, startISO, endISO, supabase, connected),
    listCampuses(churchId),
    getChurchAttendancePolicy(churchId),
    queuedPromise,
  ]);
  const attendanceByEventId = await listEventAttendanceSettings(
    churchId,
    month.events.map((event) => event.googleEventId),
  );
  const publishedAnnouncements = byGoogleId(published);
  const publishedByGoogleId = Object.fromEntries(
    Object.entries(publishedAnnouncements).map(([eventId, row]) => [eventId, row.id]),
  );

  return (
    <MonthCalendar
      initialYear={year}
      initialMonthIndex={monthIndex}
      initialEvents={month.events}
      initialPublishedByGoogleId={publishedByGoogleId}
      initialPublishedAnnouncements={publishedAnnouncements}
      initialEmailQueuedEventIds={queuedItems.map((item) => item.googleEventId)}
      initialAttendanceByEventId={attendanceByEventId}
      attendanceCampuses={campuses
        .filter((campus) => campus.isActive)
        .map((campus) => ({
          id: campus.id,
          name: campus.name,
          address: [campus.addressLine1, campus.city].filter(Boolean).join(", ") || null,
          hasCoordinates:
            campus.isPublic && campus.latitude !== null && campus.longitude !== null,
        }))}
      attendancePolicy={attendancePolicy}
      isAdmin={isAdmin}
      calendarConnected
      canCreateEvents={canCreateEvents}
      timeZone={timeZone}
    />
  );
}
