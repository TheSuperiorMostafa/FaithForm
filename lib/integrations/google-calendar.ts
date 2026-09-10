import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { allDaySpan } from "@/lib/integrations/all-day";
import {
  getGoogleAuthClient,
  GoogleReconnectRequiredError,
  isInvalidGrantError,
} from "@/lib/integrations/google-oauth";
import {
  getChurchCalendarId,
  markIntegrationNeedsReconnect,
} from "@/lib/integrations/tokens";
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
      await markIntegrationNeedsReconnect(
        churchId,
        "google",
        "Google access was revoked or expired. Reconnect Google in Settings.",
        supabase,
      );
      throw new GoogleReconnectRequiredError();
    }
    throw err;
  }

  return (data.items ?? [])
    .filter((e) => e.id && e.status !== "cancelled")
    .map((event) => {
      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;
      // An all-day event arrives as `date` rather than `dateTime`. The ISO
      // instant below is midnight UTC, which is a placeholder rather than a
      // time the church picked, so the flag travels with it.
      const allDay = Boolean(!event.start?.dateTime && event.start?.date);

      return {
        googleEventId: event.id!,
        calendarId,
        title: event.summary ?? "Untitled event",
        location: event.location ?? "",
        startAt: start ? new Date(start).toISOString() : new Date().toISOString(),
        endAt: end ? new Date(end).toISOString() : null,
        allDay,
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
      await markIntegrationNeedsReconnect(
        churchId,
        "google",
        "Google access was revoked or expired. Reconnect Google in Settings.",
        supabase,
      );
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
    allDay?: boolean;
  },
  supabase?: SupabaseClient,
) {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const calendar = google.calendar({ version: "v3", auth });

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // An all-day event is patched as dates. Sending `dateTime` turned it into a
  // one-hour event at midnight UTC, the evening before across the Americas.
  const when = input.allDay
    ? allDayRange(input.startAt, input.endAt)
    : {
        start: { dateTime: input.startAt, timeZone },
        end: input.endAt
          ? { dateTime: input.endAt, timeZone }
          : {
              dateTime: new Date(
                new Date(input.startAt).getTime() + 60 * 60 * 1000,
              ).toISOString(),
              timeZone,
            },
      };

  try {
    await calendar.events.patch({
      calendarId: input.calendarId,
      eventId: input.googleEventId,
      requestBody: {
        summary: input.title,
        location: input.location || undefined,
        ...when,
      },
    });
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await markIntegrationNeedsReconnect(
        churchId,
        "google",
        "Google access was revoked or expired. Reconnect Google in Settings.",
        supabase,
      );
      throw new GoogleReconnectRequiredError();
    }
    throw err;
  }
}

/** `dateTime` is cleared so the event is only ever one kind or the other. */
function allDayRange(startAt: string, endAt: string | null) {
  const span = allDaySpan(startAt, endAt);
  return {
    start: { date: span.start, dateTime: null },
    end: { date: span.end, dateTime: null },
  };
}
