import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import {
  insertCalendarEvent,
  listCalendarEventsInRange,
} from "@/lib/integrations/google-calendar";
import { GoogleReconnectRequiredError } from "@/lib/integrations/google-oauth";
import { hasIntegration } from "@/lib/integrations/tokens";
import {
  getPublishedAnnouncements,
  getPublishedAnnouncementsByGoogleId,
} from "@/lib/queries/announcements";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateEventBody = {
  title?: string;
  location?: string;
  startAt?: string;
  endAt?: string | null;
  description?: string;
};

function isValidIso(value: string | null | undefined): value is string {
  return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

export async function GET(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await featureAccessDenied("announcements", supabase);
  if (denied) return denied;

  const connected = await hasIntegration(auth.churchId, "google", supabase);
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
    const [events, publishedByGoogleId, publishedList] = await Promise.all([
      listCalendarEventsInRange(auth.churchId, startISO, endISO, supabase),
      getPublishedAnnouncementsByGoogleId(supabase, auth.churchId),
      getPublishedAnnouncements(supabase, auth.churchId),
    ]);

    const publishedAnnouncements: Record<string, (typeof publishedList)[number]> =
      {};
    for (const row of publishedList) {
      if (row.google_event_id) {
        publishedAnnouncements[row.google_event_id] = row;
      }
    }

    return NextResponse.json({
      connected: true,
      events,
      publishedByGoogleId,
      publishedAnnouncements,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await featureAccessDenied("announcements", supabase);
  if (denied) return denied;
  if (!auth.isAdmin) {
    return NextResponse.json(
      { error: "Only church admins can create calendar events." },
      { status: 403 },
    );
  }

  const connected = await hasIntegration(auth.churchId, "google", supabase);
  if (!connected) {
    return NextResponse.json(
      { error: "Google Calendar is not connected.", reconnect: true },
      { status: 409 },
    );
  }

  let body: CreateEventBody;
  try {
    body = (await request.json()) as CreateEventBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = body.title?.trim();
  const startAt = body.startAt?.trim();
  const endAt = body.endAt?.trim() || null;
  const location = body.location?.trim() || "";
  const description = body.description?.trim() || "";

  if (!title) {
    return NextResponse.json(
      { error: "A title is required." },
      { status: 400 },
    );
  }
  if (!isValidIso(startAt)) {
    return NextResponse.json(
      { error: "A valid start date and time is required." },
      { status: 400 },
    );
  }
  if (endAt && !isValidIso(endAt)) {
    return NextResponse.json(
      { error: "The end date and time is invalid." },
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
    const event = await insertCalendarEvent(
      auth.churchId,
      { title, location, startAt, endAt, description },
      supabase,
    );
    return NextResponse.json({ event }, { status: 201 });
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
    const message =
      err instanceof Error ? err.message : "Failed to create the event.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
