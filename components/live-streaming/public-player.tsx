"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { attachHlsErrorRecovery, createHlsPlayer } from "@/lib/stream/hls-player";
import { getGivePageUrl } from "@/lib/site-url";

type PublicPlayerProps = {
  churchName: string;
  slug: string;
  eventTitle: string | null;
  startsAt: string | null;
  countdownEnabled: boolean;
  status: "countdown" | "offline" | "live" | "ended";
  playbackUrl: string | null;
  logoUrl?: string | null;
  givingColor?: string | null;
};

export function PublicPlayer({
  churchName,
  slug,
  eventTitle,
  startsAt,
  countdownEnabled,
  status,
  playbackUrl,
  logoUrl,
  givingColor,
}: PublicPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [audioMuted, setAudioMuted] = useState(true);

  useEffect(() => {
    if (status !== "countdown" || !startsAt || !countdownEnabled) {
      setCountdown(null);
      return;
    }

    const tick = () => {
      const diff = new Date(startsAt).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("Starting soon…");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${h}h ${m}m ${s}s`);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, startsAt, countdownEnabled]);

  useEffect(() => {
    if (status !== "live" || !playbackUrl || !videoRef.current) {
      setPlaybackError(null);
      return;
    }

    let hls: import("hls.js").default | null = null;
    let cancelled = false;

    void (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled || !videoRef.current) return;
      if (Hls.isSupported()) {
        const instance = createHlsPlayer(Hls);
        attachHlsErrorRecovery(instance, Hls, () => {
          if (!cancelled) {
            setPlaybackError("Could not play the live stream. Try refreshing.");
          }
        });
        instance.loadSource(playbackUrl);
        instance.attachMedia(videoRef.current);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          setPlaybackError(null);
          void videoRef.current?.play().catch(() => null);
        });
        hls = instance;
      } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = playbackUrl;
      }
    })();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [status, playbackUrl]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-12 rounded-lg object-cover" />
        ) : null}
        <div>
          <h1 className="font-heading text-2xl font-bold">{churchName}</h1>
          <p className="text-sm text-muted-foreground">
            {eventTitle ?? "Live Stream"}
          </p>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-border bg-black shadow-lg">
        {status === "live" && playbackUrl ? (
          <div className="relative">
            <video
              ref={videoRef}
              className="aspect-video w-full"
              controls
              autoPlay
              muted={audioMuted}
              playsInline
            />
            {audioMuted ? (
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = false;
                  setAudioMuted(false);
                  void video.play().catch(() => null);
                }}
                className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-black/85"
              >
                <VolumeX className="size-4" aria-hidden />
                Tap to unmute
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = true;
                  setAudioMuted(true);
                }}
                className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/90 backdrop-blur-sm"
              >
                <Volume2 className="size-3.5" aria-hidden />
                Mute
              </button>
            )}
            {playbackError ? (
              <p className="absolute inset-x-0 bottom-0 bg-black/70 px-4 py-2 text-center text-xs text-white/90">
                {playbackError}
              </p>
            ) : null}
          </div>
        ) : status === "live" ? (
          <div className="flex aspect-video items-center justify-center text-white/80">
            Stream is starting…
          </div>
        ) : status === "countdown" && countdown ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 text-white">
            <p className="text-sm uppercase tracking-widest text-white/70">
              Service starts in
            </p>
            <p className="font-mono text-4xl font-bold">{countdown}</p>
          </div>
        ) : status === "ended" ? (
          <div className="flex aspect-video items-center justify-center text-white/80">
            This broadcast has ended.
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center text-white/80">
            Stream offline — check back at service time.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={getGivePageUrl(slug)}
          className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ backgroundColor: givingColor ?? "#1e3a5f" }}
        >
          Give online
        </Link>
      </div>
    </div>
  );
}
