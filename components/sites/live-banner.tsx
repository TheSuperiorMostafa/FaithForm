"use client";

import { useEffect, useState } from "react";

import {
  liveBannerHeadline,
  parseSiteLiveStatus,
  siteLivePollDelay,
  siteLiveStatusUrl,
  type SiteLiveStatus,
} from "@/lib/sites/live-banner";

/**
 * "<Church> is now live — Watch now", pinned above the site nav.
 *
 * The first state comes from the server render, so a visitor who arrives
 * mid-service sees the banner in the initial HTML with no shift. After that a
 * slow poll of the cached public status endpoint adds or removes it; an
 * insertion then is intentional (a service just started) and sits above the
 * fold, where browsers' scroll anchoring keeps a scrolled reader in place.
 */
export function SiteLiveBanner({
  slug,
  churchName,
  href,
  initial,
}: {
  slug: string;
  churchName: string;
  href: string;
  initial: SiteLiveStatus;
}) {
  const [status, setStatus] = useState<SiteLiveStatus>(initial);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer: number | null = null;
    let failures = 0;

    const poll = async () => {
      try {
        const res = await fetch(siteLiveStatusUrl(slug), { signal: controller.signal });
        if (cancelled) return;
        const next = res.ok ? parseSiteLiveStatus(await res.json()) : null;
        if (cancelled) return;
        if (!next) {
          failures += 1;
          return;
        }
        failures = 0;
        setStatus((prev) => (prev.live === next.live && prev.eventTitle === next.eventTitle ? prev : next));
      } catch {
        // Abort on unmount, or a network blip the backoff absorbs. Keep the last known state.
        if (!cancelled) failures += 1;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void poll().then(schedule);
      }, siteLivePollDelay(document.hidden, failures));
    };

    // The server render is fresh; start with a wait rather than a second read.
    schedule();

    const onVisibilityChange = () => {
      if (document.hidden || cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      void poll().then(schedule);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [slug]);

  return (
    // The live region persists while empty so the banner is announced when a
    // service starts during the visit.
    <div className="site-live-banner-region" aria-live="polite">
      {status.live ? (
        <a className="site-live-banner" href={href}>
          <span className="site-live-banner-dot" aria-hidden />
          <span className="site-live-banner-text">
            <strong className="site-live-banner-full">{liveBannerHeadline(churchName)}</strong>
            {/* Phones: a long church name would truncate away the "is now live" part. */}
            <strong className="site-live-banner-short">We&apos;re live now</strong>
            {status.eventTitle ? <span className="site-live-banner-title"> · {status.eventTitle}</span> : null}
          </span>
          <span className="site-live-banner-cta">
            Watch now <span aria-hidden>→</span>
          </span>
        </a>
      ) : null}
    </div>
  );
}
