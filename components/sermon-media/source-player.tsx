"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type SourcePlayerHandle = {
  /** Move to a time without starting playback. */
  seek: (seconds: number) => void;
  /** Play from `from`; pause by itself at `until` when given. */
  playFrom: (from: number, until?: number) => void;
  pause: () => void;
  currentTime: () => number;
};

/**
 * The recording on its untrimmed timeline, with a handle so transcript and
 * clip controls can seek it. Same playback approach as RecordingPlayer:
 * Safari plays HLS natively, other browsers through hls.js; a single-file
 * recording is a plain video. Native controls, nothing hover-only.
 */
export function SourcePlayer({
  ref,
  src,
  kind,
  poster,
  title,
  className,
  videoClassName,
  onTimeUpdate,
  onPlayingChange,
  children,
}: {
  ref?: React.Ref<SourcePlayerHandle>;
  src: string;
  kind: "hls" | "progressive";
  poster?: string | null;
  title: string;
  className?: string;
  videoClassName?: string;
  onTimeUpdate?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Drawn over the video (for example a crop guide). Pointer events pass through. */
  children?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const stopAt = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);

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

  useImperativeHandle(
    ref,
    () => {
      const applySeek = (seconds: number) => {
        const video = videoRef.current;
        const target = Math.max(0, seconds);
        if (!video) return;
        if (video.readyState >= 1) {
          video.currentTime = target;
          pendingSeek.current = null;
        } else {
          pendingSeek.current = target;
        }
      };
      return {
        seek: (seconds) => {
          stopAt.current = null;
          applySeek(seconds);
        },
        playFrom: (from, until) => {
          applySeek(from);
          stopAt.current = until ?? null;
          void videoRef.current?.play().catch(() => undefined);
        },
        pause: () => videoRef.current?.pause(),
        currentTime: () => videoRef.current?.currentTime ?? 0,
      };
    },
    [],
  );

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-black", className)}>
      <video
        ref={videoRef}
        className={cn("aspect-video w-full", videoClassName)}
        controls
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        aria-label={title}
        onLoadedMetadata={(event) => {
          if (pendingSeek.current !== null) {
            event.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
        onError={() => setFailed(true)}
        onPlay={() => onPlayingChange?.(true)}
        onPause={() => onPlayingChange?.(false)}
        onSeeking={(event) => {
          // A manual seek outside the preview window ends the auto-pause.
          const at = event.currentTarget.currentTime;
          if (stopAt.current !== null && at > stopAt.current) stopAt.current = null;
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (stopAt.current !== null && video.currentTime >= stopAt.current) {
            stopAt.current = null;
            video.pause();
          }
          onTimeUpdate?.(video.currentTime);
        }}
      />
      {children ? <div className="pointer-events-none absolute inset-0">{children}</div> : null}
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
