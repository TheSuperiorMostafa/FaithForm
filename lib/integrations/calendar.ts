import type { SupabaseClient } from "@supabase/supabase-js";

import {
  insertAppleCalendarEvent,
  isAppleEventId,
  listAppleCalendarEventsInRange,
  patchAppleCalendarEvent,
} from "@/lib/integrations/apple-calendar";
import {
  insertCalendarEvent,
  listCalendarEventsInRange,
  patchCalendarEvent,
} from "@/lib/integrations/google-calendar";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import type { CalendarEventPreview } from "@/lib/integrations/types";

/**
 * One church calendar, however many services it is actually spread across.
 *
 * Announcements never cared which calendar an event came from — it cared that
 * the church put it somewhere. A church on Google keeps working exactly as
 * before; a church on iCloud gets the same screens; a church running both
 * (the office on Google, the pastor on iCloud) sees one merged week.
 */

export type ChurchCalendarResult = {
  events: CalendarEventPreview[];
  /** One provider failing must not blank out the other's events. */
  errors: string[];
  connected: { google: boolean; apple: boolean };
};

export async function listChurchCalendarEvents(
  churchId: string,
  startISO: string,
  endISO: string,
  supabase?: SupabaseClient,
  knownConnected?: { google: boolean; apple: boolean },
): Promise<ChurchCalendarResult> {
  const status = knownConnected
    ? null
    : await getIntegrationStatus(churchId, supabase);
  const connected =
    knownConnected ??
    ({
      google: Boolean(status?.google.connected),
      apple: Boolean(status?.apple.connected),
    } as const);

  const [google, apple] = await Promise.all([
    settle(
      connected.google
        ? listCalendarEventsInRange(churchId, startISO, endISO, supabase).then(
            (events) =>
              events.map((event) => ({ ...event, source: "google" as const })),
          )
        : Promise.resolve([]),
    ),
    settle(
      connected.apple
        ? listAppleCalendarEventsInRange(churchId, startISO, endISO, supabase)
        : Promise.resolve([]),
    ),
  ]);

  return {
    events: [...google.events, ...apple.events].sort((a, b) =>
      a.startAt.localeCompare(b.startAt),
    ),
    errors: [google.error, apple.error].filter(
      (error): error is string => Boolean(error),
    ),
    connected,
  };
}

async function settle(
  promise: Promise<CalendarEventPreview[]>,
): Promise<{ events: CalendarEventPreview[]; error: string | null }> {
  try {
    return { events: await promise, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Calendar sync failed";
    // Callers append their own sentence ("Try reconnecting…"), so end this one.
    return {
      events: [],
      error: /[.!?]$/.test(message) ? message : `${message}.`,
    };
  }
}

export async function hasAnyCalendar(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  const status = await getIntegrationStatus(churchId, supabase);
  return status.google.connected || status.apple.connected;
}

/**
 * Where a new event goes when both calendars are connected: Google, because
 * that is also where the weekly Gmail draft is read from.
 */
export async function insertChurchCalendarEvent(
  churchId: string,
  input: {
    title: string;
    location?: string;
    description?: string;
    startAt: string;
    endAt: string | null;
  },
  supabase?: SupabaseClient,
): Promise<CalendarEventPreview> {
  const status = await getIntegrationStatus(churchId, supabase);

  if (status.google.connected) {
    const event = await insertCalendarEvent(churchId, input, supabase);
    return { ...event, source: "google" };
  }

  if (status.apple.connected) {
    return insertAppleCalendarEvent(churchId, input, supabase);
  }

  throw new Error("No calendar is connected.");
}

/** Sends an edit back to whichever calendar the event actually lives on. */
export async function patchChurchCalendarEvent(
  churchId: string,
  input: {
    eventId: string;
    calendarId: string;
    title: string;
    location: string;
    startAt: string;
    endAt: string | null;
  },
  supabase?: SupabaseClient,
): Promise<void> {
  if (isAppleEventId(input.eventId)) {
    await patchAppleCalendarEvent(churchId, input, supabase);
    return;
  }

  await patchCalendarEvent(
    churchId,
    {
      googleEventId: input.eventId,
      calendarId: input.calendarId,
      title: input.title,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
    },
    supabase,
  );
}
