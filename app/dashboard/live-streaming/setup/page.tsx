import { redirect } from "next/navigation";

import { EncoderDocsCard } from "@/components/live-streaming/encoder-docs-card";
import { EncoderPairingCard } from "@/components/live-streaming/encoder-pairing-card";
import { EncoderSetupCard } from "@/components/live-streaming/encoder-setup-card";
import { PlatformsCard } from "@/components/live-streaming/platforms-card";
import { RecordingSettingsCard } from "@/components/live-streaming/setup/recording-settings-card";
import { WatchLinksCard } from "@/components/live-streaming/watch-links-card";
import { getChurchAuth } from "@/lib/auth/church";
import { listEncoderDevices } from "@/lib/stream/encoder";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { listMediaSeries } from "@/lib/stream/media-library";
import { getRecordingSettings } from "@/lib/stream/recording-publication";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Stream setup: everything configured once and then left alone, kept off the
 * Sunday-morning screen.
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
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <EncoderSetupCard ingestServerUrl={status.settings.ingestServerUrl} isAdmin={auth.isAdmin} />
        <EncoderDocsCard />
        <EncoderPairingCard isAdmin={auth.isAdmin} devices={devices} />
      </div>
      <div className="flex flex-col gap-6">
        <RecordingSettingsCard
          initial={settings}
          series={series.map((item) => ({ id: item.id, name: item.name }))}
          isAdmin={auth.isAdmin}
        />
        <PlatformsCard isAdmin={auth.isAdmin} youtube={push("youtube")} facebook={push("facebook")} />
        <WatchLinksCard shareLinks={status.shareLinks} />
      </div>
    </div>
  );
}
