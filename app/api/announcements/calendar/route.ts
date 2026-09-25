import { NextResponse } from "next/server";
import { listEmailQueue } from "@/lib/announcements/email-queue";
import { getChurchAuth } from "@/lib/auth/church";
import { AppleReconnectRequiredError } from "@/lib/integrations/apple-calendar";
import {
  hasAnyCalendar,
  insertChurchCalendarEvent,
  listChurchCalendarEvents,
} from "@/lib/integrations/calendar";
import { GoogleReconnectRequiredError } from "@/lib/integrations/google-oauth";
import {
  getPublishedAnnouncements,
  getPublishedAnnouncementsByGoogleId,
} from "@/lib/queries/announcements";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";
import {
  listEventAttendanceSettings,
  saveEventAttendance,
} from "@/lib/attendance/v2/event-attendance";
import { getMondayWeekWindowInTimeZone } from "@/lib/utils/calendar";
import { toUserError } from "@/lib/errors/user-error";
import { VisitorError } from "@/lib/faithform/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateEventBody = {
  title?: string;
  location?: string;
  startAt?: string;
  endAt?: string | null;
  description?: string;
  attendance?: Record<string, unknown>;
};

function isValidIso(value: string | null | undefined): value is string {
  return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

export async function GET(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const denied = await featureAccessDenied("announcements", supabase);
  if (denied) return denied;

  const connected = await hasAnyCalendar(auth.churchId, supabase);
  if (!connected) {
    return NextResponse.json({
      connected: false,
      events: [],
      publishedByGoogleId: {},
    });
  }

  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  let startISO: string;
  let endISO: string;

  if (startParam && endParam) {
    startISO = startParam;
    endISO = endParam;
  } else {
    const days = Math.min(30, Math.max(1, Number(searchParams.get("days") ?? 14)));
    const timeMin = new Date();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + days);
    startISO = timeMin.toISOString();
    endISO = timeMax.toISOString();
  }

  try {
    const week = getMondayWeekWindowInTimeZone(new Date(), auth.churchTimezone);
    const [calendar, publishedByGoogleId, publishedList, queued] = await Promise.all([
      listChurchCalendarEvents(auth.churchId, startISO, endISO, supabase),
      getPublishedAnnouncementsByGoogleId(supabase, auth.churchId),
      getPublishedAnnouncements(supabase, auth.churchId),
      listEmailQueue(auth.churchId, week.weekStartKey, supabase),
    ]);

    const publishedAnnouncements: Record<string, (typeof publishedList)[number]> =
      {};
    for (const row of publishedList) {
      if (row.google_event_id) {
        publishedAnnouncements[row.google_event_id] = row;
      }
    }

    const attendanceByEventId = await listEventAttendanceSettings(
      auth.churchId,
      calendar.events.map((event) => event.googleEventId),
    );

    if (calendar.errors.length > 0) {
      console.error("[announcements] calendar read:", calendar.errors.join(" "));
    }

    return NextResponse.json({
      connected: true,
      events: calendar.events,
      publishedByGoogleId,
      publishedAnnouncements,
      attendanceByEventId,
      emailQueuedEventIds: queued.map((item) => item.googleEventId),
      // One calendar failing still returns the other's events; the client
      // shows this beside them rather than instead of them. What the provider
      // said goes to the log, not the page.
      calendarError:
        calendar.errors.length > 0
          ? "Some of your calendar couldn't be read just now."
          : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: toUserError(err, "We couldn't load your calendar") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const denied = await featureAccessDenied("announcements", supabase);
  if (denied) return denied;
  if (!auth.isAdmin) {
    return NextResponse.json(
      { error: "Only church admins can create calendar events." },
      { status: 403 },
    );
  }

  const connected = await hasAnyCalendar(auth.churchId, supabase);
  if (!connected) {
    return NextResponse.json(
      { error: "No calendar is connected. Connect one in Settings.", reconnect: true },
      { status: 409 },
    );
  }

  let body: CreateEventBody;
  try {
    body = (await request.json()) as CreateEventBody;
  } catch {
    return NextResponse.json(
      { error: "Something in the form isn't right. Check it and try again." },
      { status: 400 },
    );
  }

  const title = body.title?.trim();
  const startAt = body.startAt?.trim();
  const endAt = body.endAt?.trim() || null;
  const location = body.location?.trim() || "";
  const description = body.description?.trim() || "";

  if (!title) {
    return NextResponse.json(
      { error: "Give the event a title." },
      { status: 400 },
    );
  }
  if (!isValidIso(startAt)) {
    return NextResponse.json(
      { error: "Choose a start date and time." },
      { status: 400 },
    );
  }
  if (endAt && !isValidIso(endAt)) {
    return NextResponse.json(
      { error: "Choose a valid end date and time." },
      { status: 400 },
    );
  }
  if (endAt && Date.parse(endAt) <= Date.parse(startAt)) {
    return NextResponse.json(
      { error: "The end time must be after the start time." },
      { status: 400 },
    );
  }

  try {
    const event = await insertChurchCalendarEvent(
      auth.churchId,
      { title, location, startAt, endAt, description },
      supabase,
    );
    let attendance = null;
    let attendanceWarning: string | null = null;
    if (body.attendance && body.attendance.enabled === true) {
      try {
        attendance = await saveEventAttendance({
          churchId: auth.churchId,
          churchTimezone: auth.churchTimezone,
          actorUserId: auth.userId,
          values: {
            ...body.attendance,
            calendarEventId: event.googleEventId,
            calendarId: event.calendarId,
            calendarSource: event.source ?? "google",
            title: event.title,
            startAt: event.startAt,
            endAt: event.endAt,
            allDay: Boolean(event.allDay),
          },
        });
      } catch (attendanceError) {
        // A VisitorError was written for people; anything else is logged.
        if (attendanceError instanceof VisitorError) {
          attendanceWarning = `The event was created, but check-in needs attention: ${attendanceError.message}`;
        } else {
          console.error("[announcements] event attendance:", attendanceError);
          attendanceWarning =
            "The event was created, but check-in couldn't be turned on. Open the event to try again.";
        }
      }
    }
    return NextResponse.json({ event, attendance, attendanceWarning }, { status: 201 });
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError) {
      return NextResponse.json(
        {
          error: "Google needs to be reconnected in Settings.",
          reconnect: true,
        },
        { status: 409 },
      );
    }
    if (err instanceof AppleReconnectRequiredError) {
      return NextResponse.json(
        { error: "iCloud needs to be reconnected in Settings.", reconnect: true },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: toUserError(err, "We couldn't add the event to your calendar") },
      { status: 500 },
    );
  }
}
