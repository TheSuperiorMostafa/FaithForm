"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes server-rendered state while something on the page is still changing. */
export function AutoRefresh({ active, everyMs = 10_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
