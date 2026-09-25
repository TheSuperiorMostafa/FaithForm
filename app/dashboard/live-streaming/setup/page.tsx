import { redirect } from "next/navigation";

import { EncoderDocsCard } from "@/components/live-streaming/encoder-docs-card";
import { EncoderPairingCard } from "@/components/live-streaming/encoder-pairing-card";
import { PlatformsCard } from "@/components/live-streaming/platforms-card";
import { StreamingSetupGuide } from "@/components/live-streaming/setup/streaming-setup-guide";
import { WatchLinksCard } from "@/components/live-streaming/watch-links-card";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { listEncoderDevices } from "@/lib/stream/encoder";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { listMediaSeries } from "@/lib/stream/media-library";
import { getRecordingSettings } from "@/lib/stream/recording-publication";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Set up streaming: three guided steps, done once and then left alone, kept
 * off the Sunday-morning screen. Everything technical is one click away under
 * "Technical details" (in step 1) or "Advanced" (below the steps).
 */
export default async function StreamSetupPage() {
  const supabase = createClient();
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [status, devices, settings, series] = await Promise.all([
    getLiveBroadcastStatus(auth.churchId, supabase),
    auth.isAdmin ? listEncoderDevices(auth.churchId, supabase) : Promise.resolve([]),
    getRecordingSettings(auth.churchId),
    listMediaSeries(auth.churchId),
  ]);

  const push = (platform: "youtube" | "facebook") => ({
    connected: status.platforms[platform].connected,
    detail:
      platform === "youtube" ? status.platforms.youtube.channelTitle : status.platforms.facebook.pageName,
    destinationReady: status.platforms[platform].destinationReady,
    lastPush: status.platforms[platform].lastPush,
    needsReconnect: status.platforms[platform].needsReconnect,
    reconnectReason: status.platforms[platform].reconnectReason,
  });

  return (
    <div className="flex w-full flex-col gap-8">
      <SectionHeader
        title="Set up streaming"
        description="Three steps. You only need to do this once."
      />

      <StreamingSetupGuide
        ingestServerUrl={status.settings.ingestServerUrl}
        isAdmin={auth.isAdmin}
        settings={settings}
        series={series.map((item) => ({ id: item.id, name: item.name }))}
        youtube={push("youtube")}
        facebook={push("facebook")}
      />

      <AdvancedSection
        title="Advanced"
        description="Streaming PC pairing, encoder settings, embed code, and how your last service reached YouTube and Facebook"
      >
        <EncoderPairingCard isAdmin={auth.isAdmin} devices={devices} />
        <div className="border-t border-border pt-5">
          <EncoderDocsCard />
        </div>
        <div className="border-t border-border pt-5">
          <WatchLinksCard shareLinks={status.shareLinks} />
        </div>
        <div className="flex flex-col gap-4 border-t border-border pt-5">
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-lg font-semibold">YouTube and Facebook</h3>
            <p className="text-[15px] text-muted-foreground">Whether your video reached them last time.</p>
          </div>
          <PlatformsCard isAdmin={auth.isAdmin} youtube={push("youtube")} facebook={push("facebook")} />
        </div>
      </AdvancedSection>
    </div>
  );
}
