"use client";

import { useEffect, useState } from "react";
import { LiveChat } from "@/components/live-streaming/live-chat";
import { PublicPlayer } from "@/components/live-streaming/public-player";

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
  churchId: string;
};

type PublicWatchClientProps = {
  slug: string;
  embed?: boolean;
};

export function PublicWatchClient({ slug, embed = false }: PublicWatchClientProps) {
  const [status, setStatus] = useState<PublicStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const res = await fetch(`/api/stream/public-status?slug=${slug}`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as PublicStatus;
      setStatus(data);
    };

    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
            churchId={status.churchId}
            enabled
          />
        </div>
      ) : null}
    </div>
  );
}
