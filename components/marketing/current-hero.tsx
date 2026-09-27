import { ArrowDown, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { contactHref } from "./config";

export function CurrentHero({ preview }: { preview: ReactNode }) {
  return (
    <section className="marketing-hero" aria-labelledby="marketing-hero-title">
      <div className="marketing-hero-noise" aria-hidden="true" />
      <div className="marketing-container marketing-hero-grid">
        <div className="marketing-hero-copy">
          <span className="marketing-eyebrow marketing-hero-eyebrow"><span className="marketing-eyebrow-line" /> As a pastor</span>
          <h1 id="marketing-hero-title">It&apos;s time to <em>stop punching</em> your computer.</h1>
          <p className="marketing-hero-deck">FaithForm&apos;s web dashboard takes the admin work off your plate, so your time can go back to people, preparation, and ministry.</p>
          <div className="marketing-hero-actions">
            <a className="marketing-button marketing-button-navy" href={contactHref}>Let&apos;s talk <ArrowUpRight size={19} aria-hidden="true" /></a>
            <span className="marketing-text-link marketing-text-cue">Keep scrolling <ArrowDown size={17} aria-hidden="true" /></span>
          </div>
          <div className="marketing-hero-note"><span className="marketing-note-rule" /> Made for churches. Built around yours.</div>
        </div>
        <div className="marketing-hero-art" aria-label="FaithForm web dashboard for pastors">
          <div className="marketing-hero-orbit marketing-hero-orbit-one" aria-hidden="true" />
          <div className="marketing-hero-orbit marketing-hero-orbit-two" aria-hidden="true" />
          {preview}
        </div>
      </div>
      <div className="marketing-scroll-cue" aria-hidden="true"><span>SCROLL TO FEEL THE DIFFERENCE</span><ArrowDown size={16} /></div>
    </section>
  );
}
