"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Re-read authorized server data while staff are watching attendance. */
export function LiveAttendanceRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || pending || !navigator.onLine) return;
      startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 15_000);
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
