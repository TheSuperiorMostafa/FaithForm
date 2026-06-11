import Link from "next/link";
import { redirect } from "next/navigation";
import { MonthCalendar } from "@/components/announcements/month-calendar";
import { PublishedAnnouncementsList } from "@/components/announcements/published-announcements-list";
import { Button } from "@/components/ui/button";
import { listCalendarEventsInRange } from "@/lib/integrations/google-calendar";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import {
  getPublishedAnnouncements,
  getPublishedAnnouncementsByGoogleId,
} from "@/lib/queries/announcements";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";
import { getMonthWindowForDate } from "@/lib/utils/calendar";

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

  const integrationStatus = await getIntegrationStatus(churchId, supabase);
  const googleConnected = integrationStatus.google.connected;
  const facebookConnected = integrationStatus.facebook.connected;

  const now = new Date();
  const { year, monthIndex, startISO, endISO } = getMonthWindowForDate(now);

  let initialEvents: Awaited<ReturnType<typeof listCalendarEventsInRange>> = [];
  let publishedByGoogleId: Record<string, string> = {};
  let calendarError: string | null = null;

  if (googleConnected) {
    try {
      const [events, publishedMap] = await Promise.all([
        listCalendarEventsInRange(churchId, startISO, endISO, supabase),
        getPublishedAnnouncementsByGoogleId(supabase, churchId),
      ]);
      initialEvents = events;
      publishedByGoogleId = publishedMap;
    } catch (err) {
      calendarError =
        err instanceof Error ? err.message : "Could not load Google Calendar";
    }
  }

  const published = await getPublishedAnnouncements(supabase, churchId);

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Announcements
          </h1>
          <p className="text-sm text-muted-foreground">
            Your Google Calendar month view — click an event to verify and submit.
          </p>
        </div>
        {!googleConnected && (
          <Link href="/dashboard/settings">
            <Button variant="outline">Connect Google</Button>
          </Link>
        )}
      </div>

      {calendarError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {calendarError}. Try reconnecting Google in Settings.
        </p>
      )}

      <MonthCalendar
        churchId={churchId}
        initialYear={year}
        initialMonthIndex={monthIndex}
        initialEvents={initialEvents}
        initialPublishedByGoogleId={publishedByGoogleId}
        googleConnected={googleConnected}
        facebookConnected={facebookConnected}
      />

      <PublishedAnnouncementsList published={published} />
    </div>
  );
}
