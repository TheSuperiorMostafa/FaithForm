import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LiveStreamingDashboard } from "@/components/live-streaming/live-streaming-dashboard";
import { getChurchAuth } from "@/lib/auth/church";
import { listStreamEvents } from "@/lib/stream/events";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import {
  ensureStreamRelayCredentials,
  getStreamRelaySettings,
} from "@/lib/stream/relay";
import { createClient } from "@/lib/supabase/server";
import { listEncoderDevices } from "@/lib/stream/encoder";

export const dynamic = "force-dynamic";

export default async function LiveStreamingPage() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const [settings, broadcastStatus, devices, events, churchRow] =
    await Promise.all([
      auth.isAdmin
        ? ensureStreamRelayCredentials(auth.churchId, auth.userId, supabase)
        : getStreamRelaySettings(auth.churchId, {
            includeSecret: false,
            supabase,
          }),
      getLiveBroadcastStatus(auth.churchId, supabase),
      auth.isAdmin
        ? listEncoderDevices(auth.churchId, supabase)
        : Promise.resolve([]),
      listStreamEvents(auth.churchId, { limit: 10, supabase }),
      supabase
        .from("churches")
        .select("name, logo_url, giving_primary_color")
        .eq("id", auth.churchId)
        .maybeSingle(),
    ]);

  const branding = {
    logoUrl: (churchRow.data?.logo_url as string | null) ?? null,
    churchName: (churchRow.data?.name as string) ?? "",
    primaryColor:
      (churchRow.data?.giving_primary_color as string | null) ?? "#1e3a5f",
  };

  return (
    <Suspense fallback={null}>
      <LiveStreamingDashboard
        settings={settings}
        isAdmin={auth.isAdmin}
        youtubeConnected={broadcastStatus.platforms.youtube.connected}
        youtubeChannelTitle={broadcastStatus.platforms.youtube.channelTitle}
        facebookConnected={broadcastStatus.platforms.facebook.connected}
        facebookPageName={broadcastStatus.platforms.facebook.pageName}
        youtubePush={{
          connected: broadcastStatus.platforms.youtube.connected,
          detail: broadcastStatus.platforms.youtube.channelTitle,
          destinationReady: broadcastStatus.platforms.youtube.destinationReady,
          lastPush: broadcastStatus.platforms.youtube.lastPush,
          needsReconnect: broadcastStatus.platforms.youtube.needsReconnect,
          reconnectReason: broadcastStatus.platforms.youtube.reconnectReason,
        }}
        facebookPush={{
          connected: broadcastStatus.platforms.facebook.connected,
          detail: broadcastStatus.platforms.facebook.pageName,
          destinationReady: broadcastStatus.platforms.facebook.destinationReady,
          lastPush: broadcastStatus.platforms.facebook.lastPush,
          needsReconnect: broadcastStatus.platforms.facebook.needsReconnect,
          reconnectReason: broadcastStatus.platforms.facebook.reconnectReason,
        }}
        initialSession={broadcastStatus.session}
        initialPreviewIngest={broadcastStatus.previewIngestActive}
        initialShareLinks={broadcastStatus.shareLinks}
        encoderDevices={devices}
        events={events}
        branding={branding}
      />
    </Suspense>
  );
}
