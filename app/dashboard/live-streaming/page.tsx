import { ServicePresentationLinker } from "@/components/live-streaming/service-presentation-linker";
import { redirect } from "next/navigation";

import { BroadcastControlCenter } from "@/components/live-streaming/broadcast/control-center";
import { ScheduleCard } from "@/components/live-streaming/schedule-card";
import { getChurchAuth } from "@/lib/auth/church";
import { getBroadcastOverview } from "@/lib/stream/broadcast-overview";
import { listStreamEvents } from "@/lib/stream/events";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { getRecordingSettings } from "@/lib/stream/recording-publication";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** A scheduled service this close is the one Go Live goes live for. */
const NEXT_SERVICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default async function LiveStreamingPage() {
  const supabase = createClient();
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [broadcastStatus, overview, events, churchRow, settings] = await Promise.all([
    getLiveBroadcastStatus(auth.churchId, supabase),
    getBroadcastOverview(auth.churchId, { includePreview: auth.isAdmin }),
    listStreamEvents(auth.churchId, { limit: 10, supabase }),
    supabase
      .from("churches")
      .select("name, logo_url, giving_primary_color")
      .eq("id", auth.churchId)
      .maybeSingle(),
    getRecordingSettings(auth.churchId),
  ]);

  const now = Date.now();
  const next = events
    .filter(
      (event) =>
        event.status === "scheduled" &&
        Date.parse(event.startsAt) > now - 3 * 60 * 60 * 1000 &&
        Date.parse(event.startsAt) < now + NEXT_SERVICE_WINDOW_MS,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];

  return (
    <div className="flex flex-col gap-6">
      <BroadcastControlCenter
        initialStatus={{
          previewIngestActive: broadcastStatus.previewIngestActive,
          shareLinks: broadcastStatus.shareLinks,
          overview,
        }}
        isAdmin={auth.isAdmin}
        nextService={next ? { id: next.id, title: next.title, startsAt: next.startsAt } : null}
        timeZone={auth.churchTimezone ?? "America/New_York"}
        settings={settings}
        platforms={{
          youtube: broadcastStatus.platforms.youtube.connected,
          facebook: broadcastStatus.platforms.facebook.connected,
        }}
        branding={{
          logoUrl: (churchRow.data?.logo_url as string | null) ?? null,
          churchName: (churchRow.data?.name as string) ?? "",
          primaryColor: (churchRow.data?.giving_primary_color as string | null) ?? "#002D5F",
        }}
      />

      {auth.isAdmin && <ServicePresentationLinker />}

      <ScheduleCard
        isAdmin={auth.isAdmin}
        events={events}
        youtubeConnected={broadcastStatus.platforms.youtube.connected}
        facebookConnected={broadcastStatus.platforms.facebook.connected}
      />
    </div>
  );
}
