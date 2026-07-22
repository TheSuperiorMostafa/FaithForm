"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { regenerateStreamRelayKey } from "@/app/dashboard/live-streaming/actions";
import { BroadcastStudioCard } from "@/components/live-streaming/broadcast-studio-card";
import { EncoderDocsCard } from "@/components/live-streaming/encoder-docs-card";
import { EncoderPairingCard } from "@/components/live-streaming/encoder-pairing-card";
import { EncoderSetupCard } from "@/components/live-streaming/encoder-setup-card";
import { PlatformsCard } from "@/components/live-streaming/platforms-card";
import { ScheduleCard } from "@/components/live-streaming/schedule-card";
import { WatchLinksCard } from "@/components/live-streaming/watch-links-card";
import type { EncoderDevice } from "@/lib/stream/encoder";
import type { StreamEvent } from "@/lib/stream/events";
import type { StreamSession } from "@/lib/stream/sessions";
import type { StreamRelaySettings } from "@/lib/stream/relay";
import type { StreamShareLinks } from "@/lib/stream/share-links";
import type { StudioBranding } from "@/lib/stream/studio-compositor";

type LiveStreamingDashboardProps = {
  settings: StreamRelaySettings;
  isAdmin: boolean;
  youtubeConnected: boolean;
  youtubeChannelTitle: string | null;
  facebookConnected: boolean;
  facebookPageName: string | null;
  initialSession: StreamSession | null;
  initialPreviewIngest: boolean;
  initialShareLinks: StreamShareLinks;
  encoderDevices: EncoderDevice[];
  events: StreamEvent[];
  branding: StudioBranding;
};

export function LiveStreamingDashboard({
  settings,
  isAdmin,
  youtubeConnected,
  youtubeChannelTitle,
  facebookConnected,
  facebookPageName,
  initialSession,
  initialPreviewIngest,
  initialShareLinks,
  encoderDevices,
  events,
  branding,
}: LiveStreamingDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [streamName, setStreamName] = useState(settings.streamName ?? "");

  useEffect(() => {
    if (searchParams.get("youtube_connected")) {
      toast.success("YouTube connected.");
      router.replace("/dashboard/live-streaming");
    } else if (searchParams.get("facebook_connected")) {
      toast.success("Facebook connected.");
      router.replace("/dashboard/live-streaming");
    } else if (searchParams.get("integration_error")) {
      toast.error(searchParams.get("integration_error"));
      router.replace("/dashboard/live-streaming");
    }
  }, [searchParams, router]);

  const handleRotateKey = () => {
    if (
      !confirm(
        "Regenerate the stream key? Update ATEM, OBS, and the streaming PC agent before your next broadcast.",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await regenerateStreamRelayKey();
      if (!result.ok) {
        toast.error(result.error ?? "Could not regenerate key.");
        return;
      }

      if (result.streamName) setStreamName(result.streamName);
      toast.success("Stream key regenerated.");
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Preview in the studio, then go live
        {youtubeConnected || facebookConnected
          ? ` to ${[
              youtubeConnected ? "YouTube" : null,
              facebookConnected ? "Facebook" : null,
            ]
              .filter(Boolean)
              .join(" and ")}`
          : " on your FaithForm watch page"}
        .
      </p>

      <BroadcastStudioCard
        isAdmin={isAdmin}
        youtubeConnected={youtubeConnected}
        facebookConnected={facebookConnected}
        initialSession={initialSession}
        initialPreviewIngest={initialPreviewIngest}
        initialShareLinks={initialShareLinks}
        branding={branding}
      />

      <EncoderSetupCard
        isAdmin={isAdmin}
        streamName={streamName}
        ingestServerUrl={settings.ingestServerUrl}
        pending={pending}
        onRotateKey={handleRotateKey}
      />

      <PlatformsCard
        isAdmin={isAdmin}
        youtubeConnected={youtubeConnected}
        youtubeChannelTitle={youtubeChannelTitle}
        facebookConnected={facebookConnected}
        facebookPageName={facebookPageName}
      />

      <ScheduleCard
        isAdmin={isAdmin}
        events={events}
        youtubeConnected={youtubeConnected}
        facebookConnected={facebookConnected}
      />

      <WatchLinksCard shareLinks={initialShareLinks} />

      <EncoderPairingCard isAdmin={isAdmin} devices={encoderDevices} />

      <EncoderDocsCard />
    </div>
  );
}
