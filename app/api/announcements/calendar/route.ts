import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { listCalendarEventsInRange } from "@/lib/integrations/google-calendar";
import { hasIntegration } from "@/lib/integrations/tokens";
import {
  getPublishedAnnouncements,
  getPublishedAnnouncementsByGoogleId,
} from "@/lib/queries/announcements";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
