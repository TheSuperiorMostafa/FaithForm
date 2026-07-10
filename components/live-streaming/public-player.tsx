"use client";

import { useEffect, useRef, useState } from "react";
import { Radio, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import {
  attachHlsErrorRecovery,
  attachLiveEdgeSync,
  createLiveHlsPlayer,
  seekVideoToLiveEdge,
} from "@/lib/stream/hls-player";
import { getGivePageUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

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
  const [secondsBehind, setSecondsBehind] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

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
      setSecondsBehind(0);
      setIsPlaying(false);
      return;
    }

    let hls: import("hls.js").default | null = null;
    let stopLiveSync: (() => void) | null = null;
    let cancelled = false;
    const video = videoRef.current;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    void (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled || !videoRef.current) return;

      if (Hls.isSupported()) {
        const instance = createLiveHlsPlayer(Hls);
        attachHlsErrorRecovery(instance, Hls, () => {
          if (!cancelled) {
            setPlaybackError("Could not play the live stream. Try refreshing.");
          }
        });
        instance.loadSource(playbackUrl);
        instance.attachMedia(videoRef.current);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          setPlaybackError(null);
          seekVideoToLiveEdge(videoRef.current!, 1);
          void videoRef.current?.play().catch(() => null);
        });
        hls = instance;
      } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current.src = playbackUrl;
        videoRef.current.addEventListener(
          "loadedmetadata",
          () => {
            seekVideoToLiveEdge(videoRef.current!, 1);
            void videoRef.current?.play().catch(() => null);
          },
          { once: true },
        );
      }

      stopLiveSync = attachLiveEdgeSync(videoRef.current, (drift) => {
        if (!cancelled) setSecondsBehind(Math.max(0, drift));
      });
    })();

    return () => {
      cancelled = true;
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      stopLiveSync?.();
      hls?.destroy();
    };
  }, [status, playbackUrl]);

  const handleJumpToLive = () => {
    const video = videoRef.current;
    if (!video) return;
    seekVideoToLiveEdge(video, 0.5);
    void video.play().catch(() => null);
  };

  const handleToggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !audioMuted;
    video.muted = next;
    setAudioMuted(next);
    if (!next) void video.play().catch(() => null);
  };

  const showJumpToLive = secondsBehind > 5;

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
              autoPlay
              muted={audioMuted}
              playsInline
              disablePictureInPicture
            />

            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg">
                <span className="size-2 animate-pulse rounded-full bg-white" />
                Live
              </span>
              {showJumpToLive ? (
                <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur-sm">
                  {Math.round(secondsBehind)}s behind
                </span>
              ) : null}
            </div>

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-10">
              <button
                type="button"
                onClick={handleToggleMute}
                className="inline-flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-black/80"
              >
                {audioMuted ? (
                  <>
                    <VolumeX className="size-4" aria-hidden />
                    Unmute
                  </>
                ) : (
                  <>
                    <Volume2 className="size-4" aria-hidden />
                    Mute
                  </>
                )}
              </button>

              <div className="flex items-center gap-2">
                {showJumpToLive ? (
                  <button
                    type="button"
                    onClick={handleJumpToLive}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25"
                  >
                    <Radio className="size-4" aria-hidden />
                    Jump to live
                  </button>
                ) : (
                  <span
                    className={cn(
                      "text-xs text-white/70",
                      isPlaying && "text-emerald-300",
                    )}
                  >
                    {isPlaying ? "Playing live" : "Connecting…"}
                  </span>
                )}
              </div>
            </div>

            {playbackError ? (
              <p className="absolute inset-x-0 bottom-14 bg-black/70 px-4 py-2 text-center text-xs text-white/90">
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
