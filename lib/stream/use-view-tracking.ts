"use client";

import { useEffect, useRef } from "react";

const VIEWER_KEY_STORAGE = "faithform_viewer_key";

/**
 * A stable, opaque per-browser id.
 *
 * Only purpose is collapsing one person's repeat plays into a single unique
 * viewer. It is random, stored locally, sent to nobody else, and cannot be
 * traced back to a person.
 */
function viewerKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(VIEWER_KEY_STORAGE);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(VIEWER_KEY_STORAGE, created);
    return created;
  } catch {
    // Private browsing, or storage disabled. The view still counts; it just
    // cannot be de-duplicated.
    return null;
  }
}

export type ViewTrackingInput = {
  slug: string;
  kind: "live" | "replay";
  source?: "website" | "app" | "embed";
  recordingId?: string;
  /** Nothing is counted until the player is actually showing something. */
  enabled: boolean;
};

/**
 * Counts one play, once, per mount.
 *
 * The status poller on the watch page re-renders often, so the guard matters:
 * without it a single service would report a view every few seconds.
 */
export function useViewTracking({
  slug,
  kind,
  source = "website",
  recordingId,
  enabled,
}: ViewTrackingInput): void {
  const sent = useRef(false);

  useEffect(() => {
    if (!enabled || sent.current || !slug) return;
    sent.current = true;

    void fetch("/api/stream/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        kind,
        source,
        recordingId,
        viewerKey: viewerKey(),
      }),
      keepalive: true,
    }).catch(() => {
      // Analytics are never worth interrupting playback for.
    });
  }, [enabled, slug, kind, source, recordingId]);
}
