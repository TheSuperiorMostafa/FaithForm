"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Refresh authorized saved call records; never import/poll the Retell API. */
export function LiveCallsRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || pending || !navigator.onLine) return;
      startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [router, pending]);
  return null;
}
