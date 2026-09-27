"use client";

import { useRef, useState } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import { contactHref } from "./config";

type FutureVideoHeroProps = { src: string; poster?: string | null; captions?: string | null };

/** Reserved for the real walkthrough. No source means the current hero remains live. */
export function FutureVideoHero({ src, poster, captions }: FutureVideoHeroProps) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const startPlayback = () => {
    setPlaying(true);
    videoRef.current?.play().catch(() => {
      // Native controls remain available if autoplay is blocked.
    });
  };

  return (
    <section className="marketing-video-hero" aria-labelledby="marketing-video-title">
      <div className="marketing-container marketing-video-hero-grid">
        <div>
          <span className="marketing-eyebrow">FaithForm for churches</span>
          <h1 id="marketing-video-title">Your time belongs with people.</h1>
          <p>See how FaithForm takes work off your desk and gives the week back to ministry.</p>
          <a className="marketing-button marketing-button-gold" href={contactHref}>Let&apos;s talk <ArrowUpRight size={18} aria-hidden="true" /></a>
        </div>
        <div className="marketing-video-frame">
          {!playing && poster ? <button type="button" className="marketing-video-poster" onClick={startPlayback} aria-label="Play FaithForm walkthrough" style={{ backgroundImage: `url(${poster})` }}><Play size={30} aria-hidden="true" /></button> : null}
          <video ref={videoRef} className={playing || !poster ? "is-visible" : ""} controls playsInline preload="none" poster={poster ?? undefined} onPlay={() => setPlaying(true)} aria-label="FaithForm walkthrough">
            <source src={src} />
            {captions ? <track kind="captions" src={captions} srcLang="en" label="English captions" default /> : null}
            Your browser does not support video playback.
          </video>
        </div>
      </div>
    </section>
  );
}
