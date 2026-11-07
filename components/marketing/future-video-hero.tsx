"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { SkeletonContainer } from "@/components/ui/skeleton";
import { DashboardPreviewSkeleton } from "./dashboard-preview-skeleton";
import { contactHref } from "./config";

const DashboardPreview = dynamic(() => import("./dashboard-preview").then((module) => module.DashboardPreview), {
  loading: () => <SkeletonContainer label="Dashboard demo"><DashboardPreviewSkeleton /></SkeletonContainer>,
});
type HeroVideoPreviewProps = { src: string; mobileSrc?: string | null; poster?: string | null; captions?: string | null };

/** Only replaces the preview inside the original marketing hero. */
export function HeroVideoPreview({ src, mobileSrc, poster, captions }: HeroVideoPreviewProps) {
  const [showDemo, setShowDemo] = useState(false);
  const [demoOpened, setDemoOpened] = useState(false);
  const [ended, setEnded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [muted, setMuted] = useState(true);
  const [replayPending, setReplayPending] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const demoRef = useRef<HTMLDivElement>(null);
  const failureTimer = useRef<number | undefined>(undefined);

  const checkMediaFailure = useCallback(() => {
    window.clearTimeout(failureTimer.current);
    // The browser can report a source error while it is still selecting or
    // retrying a source. Only show the fallback if the video is still failed.
    failureTimer.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;
      const noPlayableSource = video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
        && video.readyState === HTMLMediaElement.HAVE_NOTHING;
      if (video.error || noPlayableSource) {
        setMediaError(true);
        setReplayPending(false);
      }
    }, 300);
  }, []);

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch((error: unknown) => {
      // Pausing or reloading cancels an older play request; it is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setReplayPending(false);
        setBlocked(true);
        return;
      }
      checkMediaFailure();
    });
  }, [checkMediaFailure]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const lastSource = video.querySelector("source:last-of-type");
    // Listen directly so a failed caption track cannot mark the film as failed.
    video.addEventListener("error", checkMediaFailure);
    lastSource?.addEventListener("error", checkMediaFailure);
    // The initial error can occur before React hydrates the page.
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) checkMediaFailure();
    return () => {
      window.clearTimeout(failureTimer.current);
      video.removeEventListener("error", checkMediaFailure);
      lastSource?.removeEventListener("error", checkMediaFailure);
    };
  }, [checkMediaFailure]);

  useEffect(() => {
    if (showDemo) {
      demoRef.current?.focus({ preventScroll: true });
      return;
    }
    startPlayback();
  }, [showDemo, startPlayback]);

  function replay() {
    const video = videoRef.current;
    if (!video) return;
    setReplayPending(true);
    video.pause();
    if (video.error || video.readyState === 0) video.load();
    else video.currentTime = 0;
    // Keep the end/error card in place until a new frame is actually playing.
    if (showDemo) setShowDemo(false);
    else startPlayback();
  }

  function openDemo() {
    videoRef.current?.pause();
    setDemoOpened(true);
    setShowDemo(true);
  }

  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (video.paused && !ended) startPlayback();
  }

  return <div className="marketing-hero-media">
    <div hidden={showDemo}>
      <div className="marketing-hero-video-frame">
        <video ref={videoRef} autoPlay muted playsInline controls preload="auto" poster={poster ?? undefined}
          onPlaying={() => {
            window.clearTimeout(failureTimer.current);
            setBlocked(false);
            setEnded(false);
            setMediaError(false);
            setReplayPending(false);
          }}
          onEnded={(event) => { if (event.currentTarget.ended) setEnded(true); }}
          onVolumeChange={() => setMuted(videoRef.current?.muted ?? true)} aria-label="FaithForm product film">
          {mobileSrc && <source src={mobileSrc} type="video/mp4" media="(max-width: 767px)" />}
          <source src={src} type="video/mp4" />
          {captions && <track kind="captions" src={captions} srcLang="en" label="English captions" />}
          Your browser does not support video playback.
        </video>
        {!ended && !mediaError && <button className="marketing-hero-video-sound" type="button" onClick={toggleSound}>
          {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}{muted ? "Sound on" : "Mute"}
        </button>}
        {blocked && !ended && !mediaError && <button className="marketing-hero-video-play" type="button" onClick={startPlayback}><Play size={20} aria-hidden="true" />Play the video</button>}
        {(ended || mediaError) && <div className="marketing-hero-video-end" aria-live="polite">
          {mediaError && <p>The video couldn’t load.</p>}
          <button className="marketing-hero-media-button is-primary" type="button" onClick={openDemo}>Try the demo <ArrowRight size={16} aria-hidden="true" /></button>
          <button className="marketing-hero-media-button" type="button" onClick={replay} disabled={replayPending} aria-busy={replayPending}><RotateCcw size={15} aria-hidden="true" />Replay</button>
        </div>}
      </div>
    </div>
    <div ref={demoRef} tabIndex={-1} aria-label="Interactive FaithForm demo" hidden={!showDemo}>
      {demoOpened && <DashboardPreview />}
      <div className="marketing-hero-demo-actions">
        <button className="marketing-hero-media-button" type="button" onClick={replay}><RotateCcw size={14} aria-hidden="true" />Watch the video again</button>
        <a className="marketing-hero-media-button" href={contactHref}>Request a call <ArrowRight size={14} aria-hidden="true" /></a>
      </div>
    </div>
  </div>;
}
