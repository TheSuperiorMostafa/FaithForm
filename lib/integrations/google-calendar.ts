import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import {
  getGoogleAuthClient,
  GoogleReconnectRequiredError,
  isInvalidGrantError,
} from "@/lib/integrations/google-oauth";
import { deleteIntegration, getChurchCalendarId } from "@/lib/integrations/tokens";
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

  let data;
  try {
    ({ data } = await calendar.events.list({
      calendarId,
      timeMin: startISO,
      timeMax: endISO,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    }));
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await deleteIntegration(churchId, "google", supabase);
      throw new GoogleReconnectRequiredError();
    }
    throw err;
  }

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

export async function insertCalendarEvent(
  churchId: string,
  input: {
    title: string;
    location?: string;
    startAt: string;
    endAt: string | null;
    description?: string;
    calendarId?: string;
  },
  supabase?: SupabaseClient,
): Promise<CalendarEventPreview> {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = input.calendarId ?? (await getChurchCalendarId(churchId, supabase));

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const endDateTime =
    input.endAt ??
    new Date(new Date(input.startAt).getTime() + 60 * 60 * 1000).toISOString();

  let created;
  try {
    ({ data: created } = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: input.title,
        location: input.location || undefined,
        description: input.description || undefined,
        start: { dateTime: input.startAt, timeZone },
        end: { dateTime: endDateTime, timeZone },
      },
    }));
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await deleteIntegration(churchId, "google", supabase);
      throw new GoogleReconnectRequiredError();
    }
    throw err;
  }

  if (!created?.id) {
    throw new Error("Google Calendar did not return the created event");
  }

  const start = created.start?.dateTime ?? created.start?.date;
  const end = created.end?.dateTime ?? created.end?.date;

  return {
    googleEventId: created.id,
    calendarId,
    title: created.summary ?? input.title,
    location: created.location ?? input.location ?? "",
    startAt: start ? new Date(start).toISOString() : input.startAt,
    endAt: end ? new Date(end).toISOString() : input.endAt,
    htmlLink: created.htmlLink ?? undefined,
  };
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

  try {
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
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await deleteIntegration(churchId, "google", supabase);
      throw new GoogleReconnectRequiredError();
    }
    throw err;
  }
}
