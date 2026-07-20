"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Radio, Square } from "lucide-react";
import {
  endLiveBroadcastAction,
  goLiveBroadcast,
} from "@/app/dashboard/live-streaming/actions";
import {
  layoutLabel,
  StudioSourceControls,
} from "@/components/live-streaming/studio-source-controls";
import {
  useStudioBroadcast,
  type StudioBranding,
} from "@/components/live-streaming/use-studio-broadcast";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createHlsPlayer } from "@/lib/stream/hls-player";
import type { StreamSession } from "@/lib/stream/sessions";
import {
  formatBroadcastStatusLabel,
  formatShareDescription,
} from "@/lib/stream/platform-labels";
import { StreamShareLinksPanel } from "@/components/live-streaming/stream-share-links-panel";
import type { StreamShareLinks } from "@/lib/stream/share-links";
import { isStudioSupported } from "@/lib/stream/studio-support";
import { cn } from "@/lib/utils";

type StatusResponse = {
  session: StreamSession | null;
  previewIngestActive: boolean;
  shareLinks: StreamShareLinks;
};

type BroadcastStudioCardProps = {
  isAdmin: boolean;
  youtubeConnected: boolean;
  facebookConnected: boolean;
  initialSession: StreamSession | null;
  initialPreviewIngest: boolean;
  initialShareLinks: StreamShareLinks;
  branding: StudioBranding;
};

export function BroadcastStudioCard({
  isAdmin,
  youtubeConnected,
  facebookConnected,
  initialSession,
  initialPreviewIngest,
  initialShareLinks,
  branding,
}: BroadcastStudioCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pending, startTransition] = useTransition();
  const [session, setSession] = useState(initialSession);
  const [previewIngest, setPreviewIngest] = useState(initialPreviewIngest);
  const [shareLinks, setShareLinks] = useState(initialShareLinks);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [studioSupported, setStudioSupported] = useState(true);

  const studio = useStudioBroadcast(branding);

  const isSyndicating =
    session?.status === "live" ||
    session?.status === "waiting_for_encoder" ||
    session?.status === "preparing";

  const usingStudio = Boolean(studio.outputStream);

  useEffect(() => {
    setStudioSupported(isStudioSupported());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const res = await fetch("/api/stream/status", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as StatusResponse;
        setSession(data.session);
        setPreviewIngest(data.previewIngestActive);
        setShareLinks(data.shareLinks);
      } catch {
        // Ignore transient polling errors.
      }
    };

    const pollPlayback = async () => {
      if (usingStudio) return;
      try {
        const res = await fetch("/api/stream/playback", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { playbackUrl: string | null };
        setPlaybackUrl(data.playbackUrl);
      } catch {
        // Ignore transient polling errors.
      }
    };

    void pollStatus();
    void pollPlayback();
    const id = setInterval(() => {
      void pollStatus();
      void pollPlayback();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [usingStudio]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (studio.outputStream) {
      video.srcObject = studio.outputStream;
      video.muted = false;
      void video.play().catch(() => null);
      return () => {
        video.srcObject = null;
      };
    }

    if (!playbackUrl || (!previewIngest && !isSyndicating)) {
      video.srcObject = null;
      video.removeAttribute("src");
      return;
    }

    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    void (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled || !videoRef.current) return;

      if (Hls.isSupported()) {
        const instance = createHlsPlayer(Hls);
        instance.loadSource(playbackUrl);
        instance.attachMedia(videoRef.current);
        hls = instance;
      } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = playbackUrl;
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [studio.outputStream, playbackUrl, previewIngest, isSyndicating]);

  const handleGoLive = () => {
    startTransition(async () => {
      const result = await goLiveBroadcast();
      if (!result.ok) {
        toast.error(result.error ?? "Could not go live.");
        return;
      }
      toast.success(result.message ?? "Broadcast started.");
    });
  };

  const handleEndLive = () => {
    startTransition(async () => {
      const result = await endLiveBroadcastAction();
      if (!result.ok) {
        toast.error(result.error ?? "Could not end broadcast.");
        return;
      }
      toast.success("Broadcast stopped.");
    });
  };

  const hasPreview = usingStudio || previewIngest || isSyndicating;

  const statusLabel = isSyndicating
    ? formatBroadcastStatusLabel({
        phase: session?.status === "live" ? "live" : "starting",
        destinations: session?.destinationsSnapshot,
        youtubeConnected,
        facebookConnected,
      })
    : hasPreview
      ? "Preview — not shared yet"
      : "Start the studio or connect OBS/ATEM";

  const statusColor = isSyndicating
    ? "bg-emerald-500"
    : hasPreview
      ? "bg-amber-400"
      : "bg-muted-foreground/40";

  const canShare =
    youtubeConnected || facebookConnected || hasPreview || isSyndicating;

  return (
    <Card className="overflow-hidden border-sidebar-accent/30">
      <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
        <CardTitle className="text-base">Studio</CardTitle>
        <CardDescription>
          Switch camera, screen, or screen + camera without stopping your
          preview.{" "}
          {formatShareDescription({ youtubeConnected, facebookConnected })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {!studioSupported ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <p>
              Browser studio requires Chrome or Edge with camera and screen
              capture support. Use OBS/ATEM below if your browser is not
              supported.
            </p>
          </div>
        ) : null}

        <div className="relative overflow-hidden rounded-xl border border-border bg-black ring-1 ring-white/5">
          {hasPreview ? (
            <>
              <video
                ref={videoRef}
                className="aspect-video w-full"
                controls={!usingStudio}
                muted={!usingStudio}
                autoPlay
                playsInline
              />
              {usingStudio ? (
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    <span className="size-2 animate-pulse rounded-full bg-red-500" />
                    Preview
                  </span>
                  <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
                    {layoutLabel(studio.layout)}
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/70">
              <p>Your composited preview appears here.</p>
              <p className="text-xs text-white/50">
                Start the studio below, or stream from OBS/ATEM.
              </p>
            </div>
          )}
        </div>

        {isAdmin && studioSupported ? (
          <StudioSourceControls
            isLive={studio.isLive}
            layout={studio.layout}
            pipCorner={studio.pipCorner}
            publishing={studio.publishing}
            micLevel={studio.micLevel}
            hasLogo={Boolean(branding.logoUrl)}
            onStartStudio={() => void studio.startStudio()}
            onStopStudio={studio.stopStudio}
            onSwitchLayout={(l) => void studio.switchLayout(l)}
            onSetPipCorner={studio.setPipCorner}
          />
        ) : null}

        {isAdmin && !branding.logoUrl ? (
          <p className="text-xs text-muted-foreground">
            <Link
              href="/dashboard/settings"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Upload a logo in Settings
            </Link>{" "}
            to show it on your stream.
          </p>
        ) : null}

        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-4">
          <span
            className={cn("size-3 shrink-0 rounded-full", statusColor, {
              "animate-pulse": hasPreview || isSyndicating,
            })}
            aria-hidden
          />
          <p className="text-sm font-medium">{statusLabel}</p>
        </div>

        {isSyndicating ? (
          <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div>
              <p className="text-sm font-semibold">Where to watch</p>
              <p className="text-xs text-muted-foreground">
                Share these links with your congregation.
              </p>
            </div>
            <StreamShareLinksPanel shareLinks={shareLinks} compact />
          </div>
        ) : null}

        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            {!isSyndicating ? (
              <Button
                onClick={handleGoLive}
                disabled={pending || !canShare}
                className="gap-2"
                size="lg"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Radio className="size-4" />
                )}
                Go Live
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleEndLive}
                disabled={pending}
                className="gap-2"
                size="lg"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Square className="size-4" />
                )}
                Stop sharing
              </Button>
            )}
          </div>
        ) : null}

        {isAdmin && !youtubeConnected && !facebookConnected && !isSyndicating ? (
          <p className="text-xs text-muted-foreground">
            Connect YouTube or Facebook below to share when you go live.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
