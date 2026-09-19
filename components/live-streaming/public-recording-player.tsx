"use client";

import { RecordingPlayer } from "@/components/live-streaming/recording-player";
import { useViewTracking } from "@/lib/stream/use-view-tracking";
import { useState } from "react";

type PublicRecordingPlayerProps = {
  slug: string;
  recordingId: string;
  title: string;
  poster: string | null;
  playback: { kind: "hls" | "progressive"; url: string } | null;
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
  title,
  poster,
  playback,
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

  if (!playback) {
    return (
      <p className="rounded-xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
        This service isn&apos;t available to watch right now.
      </p>
    );
  }

  return (
    <RecordingPlayer
      src={playback.url}
      kind={playback.kind}
      poster={poster}
      title={title}
      onFirstPlay={() => setStarted(true)}
    />
  );
}
