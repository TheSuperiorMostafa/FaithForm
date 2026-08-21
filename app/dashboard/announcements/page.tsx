import Link from "next/link";
import { redirect } from "next/navigation";
import { MonthCalendar } from "@/components/announcements/month-calendar";
import { PublishedAnnouncementsList } from "@/components/announcements/published-announcements-list";
import { WeeklyAnnouncementQueue } from "@/components/announcements/weekly-announcement-queue";
import { Button } from "@/components/ui/button";
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
  getPublishedAnnouncementsByGoogleId,
  type AnnouncementRow,
} from "@/lib/queries/announcements";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";
import {
  getMondayWeekWindowInTimeZone,
  getMonthWindowForDate,
} from "@/lib/utils/calendar";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);

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

  const auth = await getChurchAuth(supabase);
  const integrationStatus = await getIntegrationStatus(churchId, supabase);
  const googleConnected = integrationStatus.google.connected;
  const appleConnected = integrationStatus.apple.connected;
  const calendarConnected = googleConnected || appleConnected;
  const facebookConnected = integrationStatus.facebook.connected;

  // The queue window follows the church's timezone, not the server's — this
  // page renders on Vercel, where server-local time is UTC.
  const { data: churchRow } = await supabase
    .from("churches")
    .select("timezone")
    .eq("id", churchId)
    .maybeSingle();
  const churchTimeZone = (churchRow?.timezone as string | null) ?? null;

  const now = new Date();
  const { year, monthIndex, startISO, endISO } = getMonthWindowForDate(now);
  const week = getMondayWeekWindowInTimeZone(now, churchTimeZone);

  type CalendarEvents = Awaited<
    ReturnType<typeof listChurchCalendarEvents>
  >["events"];
  let initialEvents: CalendarEvents = [];
  let weekEvents: CalendarEvents = [];
  let publishedByGoogleId: Record<string, string> = {};
  let publishedAnnouncementsMap: Record<string, AnnouncementRow> = {};
  let calendarError: string | null = null;

  if (calendarConnected) {
    const [month, weekWindow, publishedMap] = await Promise.all([
      listChurchCalendarEvents(churchId, startISO, endISO, supabase),
      listChurchCalendarEvents(
        churchId,
        week.weekStartISO,
        new Date(
          new Date(week.weekStartISO).getTime() +
            QUEUE_HORIZON_DAYS * 86_400_000,
        ).toISOString(),
        supabase,
      ),
      getPublishedAnnouncementsByGoogleId(supabase, churchId),
    ]);
    initialEvents = month.events;
    weekEvents = weekWindow.events;
    publishedByGoogleId = publishedMap;
    // A church on two calendars keeps the working one's events on screen and
    // is told which one needs attention.
    calendarError =
      [...new Set([...month.errors, ...weekWindow.errors])].join(" ") || null;
  }

  const published = await getPublishedAnnouncements(supabase, churchId);
  publishedAnnouncementsMap = Object.fromEntries(
    published
      .filter((row) => row.google_event_id)
      .map((row) => [row.google_event_id!, row]),
  );

  const emailSettings = await getAnnouncementEmailSettings(churchId, supabase);

  // What has actually been added to this week's email. The key rolls over at
  // Monday midnight local, which is what empties the queue.
  const queuedEventIds = new Set(
    (await listEmailQueue(churchId, week.weekStartKey, supabase)).map(
      (item) => item.googleEventId,
    ),
  );

  const weeklyQueue = buildWeeklyAnnouncementQueue(
    weekEvents,
    publishedAnnouncementsMap,
    now,
    churchTimeZone,
    queuedEventIds,
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

      {calendarError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {calendarError} Try reconnecting the calendar in Settings.
        </p>
      )}

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
        isAdmin={auth?.isAdmin ?? false}
      />

      <MonthCalendar
        churchId={churchId}
        initialYear={year}
        initialMonthIndex={monthIndex}
        initialEvents={initialEvents}
        initialPublishedByGoogleId={publishedByGoogleId}
        initialPublishedAnnouncements={publishedAnnouncementsMap}
        calendarConnected={calendarConnected}
        googleConnected={googleConnected}
        facebookConnected={facebookConnected}
      />

      <PublishedAnnouncementsList published={published} />
    </div>
  );
}
