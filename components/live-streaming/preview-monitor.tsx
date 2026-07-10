"use client";

import { useEffect, useRef } from "react";
import { MonitorPlay } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createHlsPlayer } from "@/lib/stream/hls-player";
import type { StreamSession } from "@/lib/stream/sessions";

type PreviewMonitorProps = {
  session: StreamSession | null;
  playbackUrl: string | null;
};

export function PreviewMonitor({ session, playbackUrl }: PreviewMonitorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const show =
    session?.status === "waiting_for_encoder" || session?.status === "live";

  useEffect(() => {
    if (!show || !playbackUrl || !videoRef.current) return;

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
  }, [show, playbackUrl]);

  if (!show) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MonitorPlay className="size-4 text-accent" aria-hidden />
          Preview monitor
        </CardTitle>
        <CardDescription>
          Incoming feed from your encoder (may take up to 60 seconds).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {playbackUrl ? (
          <video
            ref={videoRef}
            className="aspect-video w-full rounded-lg bg-black"
            controls
            muted
            autoPlay
            playsInline
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Waiting for encoder signal…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
