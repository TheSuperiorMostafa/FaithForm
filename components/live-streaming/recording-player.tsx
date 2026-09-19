"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type RecordingPlayerProps = {
  src: string;
  kind: "hls" | "progressive";
  poster?: string | null;
  title: string;
  className?: string;
  onFirstPlay?: () => void;
  /** Current playback position, for "use this moment" controls. */
  onTimeUpdate?: (seconds: number) => void;
};

/**
 * Plays a recorded service on the web — the website's watch page and the
 * dashboard's review screen.
 *
 * A segmented recording is a VOD HLS playlist: Safari plays it natively, every
 * other browser through hls.js (already a dependency for live). A legacy
 * single-file recording is a plain `<video src>`. Native controls throughout,
 * so keyboard, screen readers, captions menus and full screen behave the way
 * the browser already teaches people.
 */
export function RecordingPlayer({
  src,
  kind,
  poster,
  title,
  className,
  onFirstPlay,
  onTimeUpdate,
}: RecordingPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);

    if (kind === "progressive" || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    let destroyed = false;
    let instance: { destroy: () => void } | null = null;
    void (async () => {
      const { default: Hls } = await import("hls.js");
      if (destroyed || !videoRef.current) return;
      if (!Hls.isSupported()) {
        setFailed(true);
        return;
      }
      const hls = new Hls({ enableWorker: true, maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else setFailed(true);
      });
      hls.loadSource(src);
      hls.attachMedia(videoRef.current);
      instance = hls;
    })();

    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [src, kind]);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-black", className)}>
      <video
        ref={videoRef}
        className="aspect-video w-full"
        controls
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        aria-label={title}
        onPlay={() => {
          if (started.current) return;
          started.current = true;
          onFirstPlay?.();
        }}
        onError={() => setFailed(true)}
        onTimeUpdate={(event) => onTimeUpdate?.(event.currentTarget.currentTime)}
      />
      {failed ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 px-6 text-center text-sm text-white"
        >
          <p className="font-medium">This video couldn&apos;t load.</p>
          <p className="text-white/70">Check your connection and reload the page.</p>
        </div>
      ) : null}
    </div>
  );
}
