import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "@/lib/integrations/google-oauth";
import { getChurchCalendarId } from "@/lib/integrations/tokens";
import type { CalendarEventPreview } from "@/lib/integrations/types";

export async function listCalendarEventsInRange(
  churchId: string,
  startISO: string,
  endISO: string,
  supabase?: SupabaseClient,
): Promise<CalendarEventPreview[]> {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = await getChurchCalendarId(churchId, supabase);

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });

  return (data.items ?? [])
    .filter((e) => e.id && e.status !== "cancelled")
    .map((event) => {
      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;

      return {
        googleEventId: event.id!,
        calendarId,
        title: event.summary ?? "Untitled event",
        location: event.location ?? "",
        startAt: start ? new Date(start).toISOString() : new Date().toISOString(),
        endAt: end ? new Date(end).toISOString() : null,
        htmlLink: event.htmlLink ?? undefined,
      };
    });
}

export async function listUpcomingCalendarEvents(
  churchId: string,
  days = 14,
  supabase?: SupabaseClient,
): Promise<CalendarEventPreview[]> {
  const timeMin = new Date();
  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + days);

  return listCalendarEventsInRange(
    churchId,
    timeMin.toISOString(),
    timeMax.toISOString(),
    supabase,
  );
}

export async function patchCalendarEvent(
  churchId: string,
  input: {
    googleEventId: string;
    calendarId: string;
    title: string;
    location: string;
    startAt: string;
    endAt: string | null;
  },
  supabase?: SupabaseClient,
) {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const calendar = google.calendar({ version: "v3", auth });

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  await calendar.events.patch({
    calendarId: input.calendarId,
    eventId: input.googleEventId,
    requestBody: {
      summary: input.title,
      location: input.location || undefined,
      start: {
        dateTime: input.startAt,
        timeZone,
      },
      end: input.endAt
        ? { dateTime: input.endAt, timeZone }
        : {
            dateTime: new Date(
              new Date(input.startAt).getTime() + 60 * 60 * 1000,
            ).toISOString(),
            timeZone,
          },
    },
  });
}
