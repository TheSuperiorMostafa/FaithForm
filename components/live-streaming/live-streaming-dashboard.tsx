"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Settings2 } from "lucide-react";
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
import type { PlatformPushState } from "@/components/live-streaming/platforms-card";
import type { StudioBranding } from "@/lib/stream/studio-compositor";
import { cn } from "@/lib/utils";

type LiveStreamingDashboardProps = {
  settings: StreamRelaySettings;
  isAdmin: boolean;
  youtubeConnected: boolean;
  youtubeChannelTitle: string | null;
  facebookConnected: boolean;
  facebookPageName: string | null;
  youtubePush: PlatformPushState;
  facebookPush: PlatformPushState;
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
  youtubePush,
  facebookPush,
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
  const [settingsOpen, setSettingsOpen] = useState(false);

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

      <ScheduleCard
        isAdmin={isAdmin}
        events={events}
        youtubeConnected={youtubeConnected}
        facebookConnected={facebookConnected}
      />

      <PlatformsCard
        isAdmin={isAdmin}
        youtube={youtubePush}
        facebook={facebookPush}
      />

      <WatchLinksCard shareLinks={initialShareLinks} />

      {/*
        Hardware setup is configured once and then never touched again on a
        Sunday morning, so it sits behind a fold at the bottom rather than
        between the studio and the schedule.
      */}
      <section className="rounded-2xl border border-border bg-card shadow-card dark:shadow-none">
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
        >
          <span className="flex items-center gap-2">
            <Settings2 className="size-5 text-accent" strokeWidth={1.75} />
            <span className="flex flex-col">
              <span className="font-heading text-base font-semibold">
                Live settings
              </span>
              <span className="text-sm text-muted-foreground">
                Stream key, encoder presets, and the streaming PC.
              </span>
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform",
              settingsOpen && "rotate-180",
            )}
          />
        </button>

        {settingsOpen && (
          <div className="flex flex-col gap-6 border-t border-border p-5">
            <EncoderSetupCard
              isAdmin={isAdmin}
              streamName={streamName}
              ingestServerUrl={settings.ingestServerUrl}
              pending={pending}
              onRotateKey={handleRotateKey}
            />

            <EncoderPairingCard isAdmin={isAdmin} devices={encoderDevices} />

            <EncoderDocsCard />
          </div>
        )}
      </section>
    </div>
  );
}
