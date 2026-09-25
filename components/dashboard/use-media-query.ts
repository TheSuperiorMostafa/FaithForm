"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query. Server render assumes `serverValue`. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** ≥1024px: the sidebar stays open with labels. Matches Tailwind `lg`. */
export const SIDEBAR_PINNED_QUERY = "(min-width: 1024px)";
