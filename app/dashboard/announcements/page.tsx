import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MonthCalendar } from "@/components/announcements/month-calendar";
import { PublishedAnnouncementsList } from "@/components/announcements/published-announcements-list";
import { WeeklyAnnouncementQueue } from "@/components/announcements/weekly-announcement-queue";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listEmailQueue } from "@/lib/announcements/email-queue";
import {
  buildWeeklyAnnouncementQueue,
  QUEUE_HORIZON_DAYS,
} from "@/lib/announcements/weekly-email";
import { getChurchAuth } from "@/lib/auth/church";
import { listChurchCalendarEvents } from "@/lib/integrations/calendar";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import {
  getPublishedAnnouncements,
  type AnnouncementRow,
} from "@/lib/queries/announcements";
import { createClient } from "@/lib/supabase/server";
import {
  getMondayWeekWindowInTimeZone,
  getMonthWindowForDate,
} from "@/lib/utils/calendar";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const supabase = createClient();
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const churchId = auth.churchId;

  if (!churchId) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold">No church linked yet</h2>
        <p className="text-sm text-muted-foreground">
          Connect your church before managing announcements.
        </p>
      </div>
    );
  }

  const now = new Date();
  const { year, monthIndex, startISO, endISO } = getMonthWindowForDate(now);
  const churchTimeZone = auth.churchTimezone;
  const week = getMondayWeekWindowInTimeZone(now, churchTimeZone);

  const integrationStatus = await getIntegrationStatus(churchId, supabase);
  const googleConnected = integrationStatus.google.connected;
  const appleConnected = integrationStatus.apple.connected;
  const calendarConnected = googleConnected || appleConnected;
  const facebookConnected = integrationStatus.facebook.connected;
  const connected = { google: googleConnected, apple: appleConnected };

  // Start the reusable database reads once. The queue, calendar and submitted
  // list await the same promise under separate Suspense boundaries, so a slow
  // calendar provider cannot hold back the other two sections.
  const publishedPromise = getPublishedAnnouncements(supabase, churchId);
  const emailSettingsPromise = getAnnouncementEmailSettings(churchId, supabase);
  const queuedItemsPromise = listEmailQueue(
    churchId,
    week.weekStartKey,
    supabase,
  );

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Announcements
          </h1>
          <p className="text-sm text-muted-foreground">
            Review this week&apos;s queue, verify events, and publish to
            Facebook. Team emails roll into one Monday Gmail draft.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/settings?tab=communications">
            <Button variant="outline">Email template</Button>
          </Link>
          {!calendarConnected && (
            <Link href="/dashboard/settings?tab=integrations">
              <Button variant="outline">Connect a calendar</Button>
            </Link>
          )}
        </div>
      </div>

      <Suspense fallback={<AnnouncementSectionSkeleton rows={3} />}>
        <WeeklyQueueSection
          churchId={churchId}
          now={now}
          churchTimeZone={churchTimeZone}
          week={week}
          connected={connected}
          calendarConnected={calendarConnected}
          googleConnected={googleConnected}
          facebookConnected={facebookConnected}
          isAdmin={auth.isAdmin}
          publishedPromise={publishedPromise}
          emailSettingsPromise={emailSettingsPromise}
          queuedItemsPromise={queuedItemsPromise}
        />
      </Suspense>

      <Suspense fallback={<AnnouncementSectionSkeleton rows={5} tall />}>
        <CalendarSection
          churchId={churchId}
          year={year}
          monthIndex={monthIndex}
          startISO={startISO}
          endISO={endISO}
          connected={connected}
          calendarConnected={calendarConnected}
          googleConnected={googleConnected}
          facebookConnected={facebookConnected}
          publishedPromise={publishedPromise}
        />
      </Suspense>

      <Suspense fallback={<AnnouncementSectionSkeleton rows={2} />}>
        <PublishedSection publishedPromise={publishedPromise} />
      </Suspense>
    </div>
  );
}

type WeekWindow = ReturnType<typeof getMondayWeekWindowInTimeZone>;
type ConnectedCalendars = { google: boolean; apple: boolean };
type PublishedPromise = Promise<AnnouncementRow[]>;

async function WeeklyQueueSection({
  churchId,
  now,
  churchTimeZone,
  week,
  connected,
  calendarConnected,
  googleConnected,
  facebookConnected,
  isAdmin,
  publishedPromise,
  emailSettingsPromise,
  queuedItemsPromise,
}: {
  churchId: string;
  now: Date;
  churchTimeZone: string;
  week: WeekWindow;
  connected: ConnectedCalendars;
  calendarConnected: boolean;
  googleConnected: boolean;
  facebookConnected: boolean;
  isAdmin: boolean;
  publishedPromise: PublishedPromise;
  emailSettingsPromise: ReturnType<typeof getAnnouncementEmailSettings>;
  queuedItemsPromise: ReturnType<typeof listEmailQueue>;
}) {
  const supabase = createClient();
  const calendarPromise = calendarConnected
    ? listChurchCalendarEvents(
        churchId,
        week.weekStartISO,
        new Date(
          new Date(week.weekStartISO).getTime() +
            QUEUE_HORIZON_DAYS * 86_400_000,
        ).toISOString(),
        supabase,
        connected,
      )
    : Promise.resolve({ events: [], errors: [], connected });

  const [published, emailSettings, queuedItems, weekWindow] =
    await Promise.all([
      publishedPromise,
      emailSettingsPromise,
      queuedItemsPromise,
      calendarPromise,
    ]);
  const publishedMap = Object.fromEntries(
    published
      .filter((row) => row.google_event_id)
      .map((row) => [row.google_event_id!, row]),
  );
  const queuedEventIds = new Set(
    queuedItems.map((item) => item.googleEventId),
  );
  const weeklyQueue = buildWeeklyAnnouncementQueue(
    weekWindow.events,
    publishedMap,
    now,
    churchTimeZone,
    queuedEventIds,
  );
  const calendarError = [...new Set(weekWindow.errors)].join(" ");

  return (
    <>
      {calendarError && <CalendarError message={calendarError} />}
      <WeeklyAnnouncementQueue
        churchId={churchId}
        queue={weeklyQueue}
        published={published}
        calendarConnected={calendarConnected}
        googleConnected={googleConnected}
        facebookConnected={facebookConnected}
        weekLabel={week.weekLabel}
        weeklyDraftCreated={
          emailSettings.lastWeeklyDraftWeekStart === week.weekStartKey
        }
        isAdmin={isAdmin}
      />
    </>
  );
}

async function CalendarSection({
  churchId,
  year,
  monthIndex,
  startISO,
  endISO,
  connected,
  calendarConnected,
  googleConnected,
  facebookConnected,
  publishedPromise,
}: {
  churchId: string;
  year: number;
  monthIndex: number;
  startISO: string;
  endISO: string;
  connected: ConnectedCalendars;
  calendarConnected: boolean;
  googleConnected: boolean;
  facebookConnected: boolean;
  publishedPromise: PublishedPromise;
}) {
  const supabase = createClient();
  const monthPromise = calendarConnected
    ? listChurchCalendarEvents(
        churchId,
        startISO,
        endISO,
        supabase,
        connected,
      )
    : Promise.resolve({ events: [], errors: [], connected });
  const [published, month] = await Promise.all([
    publishedPromise,
    monthPromise,
  ]);
  const publishedAnnouncements = Object.fromEntries(
    published
      .filter((row) => row.google_event_id)
      .map((row) => [row.google_event_id!, row]),
  );
  const publishedByGoogleId = calendarConnected
    ? Object.fromEntries(
        published
          .filter((row) => row.google_event_id)
          .map((row) => [row.google_event_id!, row.id]),
      )
    : {};
  const calendarError = [...new Set(month.errors)].join(" ");

  return (
    <>
      {calendarError && <CalendarError message={calendarError} />}
      <MonthCalendar
        churchId={churchId}
        initialYear={year}
        initialMonthIndex={monthIndex}
        initialEvents={month.events}
        initialPublishedByGoogleId={publishedByGoogleId}
        initialPublishedAnnouncements={publishedAnnouncements}
        calendarConnected={calendarConnected}
        googleConnected={googleConnected}
        facebookConnected={facebookConnected}
      />
    </>
  );
}

async function PublishedSection({
  publishedPromise,
}: {
  publishedPromise: PublishedPromise;
}) {
  return <PublishedAnnouncementsList published={await publishedPromise} />;
}

function CalendarError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      {message} Try reconnecting the calendar in Settings.
    </p>
  );
}

function AnnouncementSectionSkeleton({
  rows,
  tall = false,
}: {
  rows: number;
  tall?: boolean;
}) {
  return (
    <Card className="space-y-4 p-5" role="status" aria-label="Loading section">
      <Skeleton className="h-6 w-48" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton
          key={index}
          className={tall ? "h-20 w-full" : "h-14 w-full"}
        />
      ))}
    </Card>
  );
}
