"use client";

import { useEffect, useState } from "react";

/** Signed video links are refreshed by every poll; keep the first one per video so playback never restarts. */
const KEEP_MS = 45 * 60_000;

export function useStableUrl(key: string | null | undefined, url: string | null | undefined): string | null {
  const [kept, setKept] = useState<{ key: string | null; url: string | null; at: number }>(() => ({
    key: key ?? null,
    url: url ?? null,
    at: Date.now(),
  }));
  useEffect(() => {
    setKept((current) => {
      const nextKey = key ?? null;
      const nextUrl = url ?? null;
      if (current.key !== nextKey) return { key: nextKey, url: nextUrl, at: Date.now() };
      if (!current.url && nextUrl) return { key: nextKey, url: nextUrl, at: Date.now() };
      // Signed links last an hour: swap in a fresh one before it runs out.
      if (nextUrl && Date.now() - current.at > KEEP_MS) return { key: nextKey, url: nextUrl, at: Date.now() };
      return current;
    });
  }, [key, url]);
  return kept.key === (key ?? null) ? kept.url : (url ?? null);
}

/** Shows the first frame on iOS Safari, which otherwise draws nothing until play. */
export function firstFrame(url: string | null): string | null {
  return url ? `${url}#t=0.1` : null;
}
