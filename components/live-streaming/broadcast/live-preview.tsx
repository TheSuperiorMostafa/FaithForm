"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorPlay } from "lucide-react";

import { createHlsPlayer } from "@/lib/stream/hls-player";

/**
 * The picture the congregation is seeing, for the person running the service.
 *
 * Muted by default so it never feeds back into the room; the controls let an
 * operator unmute to check audio. When the browser studio is the source, its
 * own composited output is shown instead, with no network round trip.
 */
export function LivePreview({
  active,
  studioStream,
  placeholder,
}: {
  active: boolean;
  studioStream: MediaStream | null;
  placeholder: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!active || studioStream) {
      setPlaybackUrl(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/stream/playback", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { playbackUrl: string | null };
        // Only swap the URL when it actually changes, so the player is not
        // torn down every refresh.
        setPlaybackUrl((current) => (current && data.playbackUrl ? current : data.playbackUrl));
      } catch {
        // A transient failure keeps the current picture.
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, studioStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (studioStream) {
      video.srcObject = studioStream;
      void video.play().catch(() => null);
      return () => {
        video.srcObject = null;
      };
    }
    if (!playbackUrl) return;

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
  }, [studioStream, playbackUrl]);

  const showVideo = Boolean(studioStream) || (active && Boolean(playbackUrl));

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-black/5">
      {showVideo ? (
        <video
          ref={videoRef}
          className="aspect-video w-full"
          muted
          autoPlay
          playsInline
          controls={!studioStream}
          aria-label="Live preview"
        />
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-3 px-6 text-center">
          <MonitorPlay className="size-10 text-white/40" strokeWidth={1.5} aria-hidden />
          <p className="max-w-sm text-sm text-white/70">{placeholder}</p>
        </div>
      )}
    </div>
  );
}
