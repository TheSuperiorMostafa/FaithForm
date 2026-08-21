"use client";

import { useEffect, useState } from "react";
import { LiveChat } from "@/components/live-streaming/live-chat";
import { PublicPlayer } from "@/components/live-streaming/public-player";
import { useViewTracking } from "@/lib/stream/use-view-tracking";

type PublicStatus = {
  churchName: string;
  slug: string;
  eventTitle: string | null;
  startsAt: string | null;
  countdownEnabled: boolean;
  chatEnabled: boolean;
  status: "countdown" | "offline" | "live" | "ended";
  playbackUrl: string | null;
  logoUrl: string | null;
  givingColor: string | null;
  streamEventId: string | null;
};

type PublicWatchClientProps = {
  slug: string;
  embed?: boolean;
};

function sameStatus(a: PublicStatus, b: PublicStatus): boolean {
  return (Object.keys(a) as (keyof PublicStatus)[]).every(
    (key) => a[key] === b[key],
  );
}

export function PublicWatchClient({ slug, embed = false }: PublicWatchClientProps) {
  const [status, setStatus] = useState<PublicStatus | null>(null);

  // Counted once the stream is actually live and playing, not on page open —
  // someone landing on a countdown has not watched anything yet.
  useViewTracking({
    slug,
    kind: "live",
    source: embed ? "embed" : "website",
    enabled: status?.status === "live" && Boolean(status.playbackUrl),
  });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer: number | null = null;
    let failures = 0;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/stream/public-status?slug=${encodeURIComponent(slug)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (cancelled) return;
        if (!res.ok) {
          failures += 1;
          return;
        }
        const data = (await res.json()) as PublicStatus;
        if (cancelled) return;
        failures = 0;
        // Only swap state when something actually changed; replacing the object
        // every poll re-rendered the whole player subtree for no reason.
        setStatus((prev) => (prev && sameStatus(prev, data) ? prev : data));
      } catch {
        // An abort on unmount is expected. Anything else is a transient network
        // failure, which the backoff below handles. Previously this rejection
        // was unhandled and surfaced as a console error on every blip.
        if (!cancelled) failures += 1;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      // Back off while the endpoint is failing, and idle right down while the
      // tab is hidden — each call costs several queries, so background tabs
      // were pure load with nobody watching.
      const base = document.hidden ? 30_000 : 5_000;
      const delay = Math.min(base * 2 ** Math.min(failures, 4), 60_000);
      timer = window.setTimeout(() => {
        void poll().then(schedule);
      }, delay);
    };

    void poll().then(schedule);

    // Resync immediately when the viewer returns to the tab.
    const onVisibilityChange = () => {
      if (!document.hidden && !cancelled) void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [slug]);

  if (!status) {
    return (
      <div className={embed ? "p-4" : "flex min-h-[40vh] items-center justify-center"}>
        <p className="text-sm text-muted-foreground">Loading stream…</p>
      </div>
    );
  }

  return (
    <div className={embed ? "" : "min-h-screen bg-background"}>
      <PublicPlayer
        churchName={status.churchName}
        slug={status.slug}
        eventTitle={status.eventTitle}
        startsAt={status.startsAt}
        countdownEnabled={status.countdownEnabled}
        status={status.status}
        playbackUrl={status.playbackUrl}
        logoUrl={status.logoUrl}
        givingColor={status.givingColor}
      />
      {status.chatEnabled && status.streamEventId && status.status === "live" ? (
        <div className="mx-auto max-w-4xl px-4 pb-8">
          <LiveChat
            streamEventId={status.streamEventId}
            slug={status.slug}
            enabled
          />
        </div>
      ) : null}
    </div>
  );
}
