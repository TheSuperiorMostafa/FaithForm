"use client";

import { useState } from "react";
import { useViewTracking } from "@/lib/stream/use-view-tracking";

type PublicRecordingPlayerProps = {
  slug: string;
  recordingId: string;
  playbackUrl: string | null;
};

/**
 * Plays a past service and counts the play.
 *
 * The count is taken on first play rather than on page load — someone who
 * opened the page and left without pressing play has not watched anything.
 */
export function PublicRecordingPlayer({
  slug,
  recordingId,
  playbackUrl,
}: PublicRecordingPlayerProps) {
  const [started, setStarted] = useState(false);

  useViewTracking({
    slug,
    recordingId,
    kind: "replay",
    // The church's app loads this page in a webview and marks itself with a
    // query flag; everything else is the website.
    source:
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("source") === "app"
        ? "app"
        : "website",
    enabled: started,
  });

  if (!playbackUrl) {
    return (
      <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
        This service isn&apos;t available to watch back.
      </p>
    );
  }

  return (
    <video
      className="aspect-video w-full rounded-xl bg-black"
      src={playbackUrl}
      controls
      preload="metadata"
      playsInline
      onPlay={() => setStarted(true)}
    />
  );
}
