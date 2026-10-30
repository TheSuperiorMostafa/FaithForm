"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshFollowUpDelivery } from "./check-texts/actions";

/** Keep queued text requests current while the follow-up page is visible. */
export function FollowUpDeliveryRefresh({ serviceDate }: { serviceDate: string }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState !== "visible" || !navigator.onLine) return;
      refreshing = true;
      try {
        const result = await refreshFollowUpDelivery(serviceDate);
        if (active && result.ok) router.refresh();
      } catch {
        // A temporary connection failure leaves the saved status for the next check.
      } finally {
        refreshing = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const resume = () => void refresh();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [router, serviceDate]);

  return null;
}
