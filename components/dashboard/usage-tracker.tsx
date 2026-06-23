"use client";

import { useEffect, useRef } from "react";

const HEARTBEAT_SECONDS = 30;

async function sendHeartbeat(seconds: number) {
  try {
    await fetch("/api/dashboard/usage/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seconds }),
      keepalive: true,
    });
  } catch {
    // Best-effort tracking — never block the pastor workflow.
  }
}

export function DashboardUsageTracker() {
  const lastBeatAt = useRef<number>(Date.now());

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      const elapsedSeconds = Math.min(
        HEARTBEAT_SECONDS,
        Math.max(1, Math.round((now - lastBeatAt.current) / 1000)),
      );
      lastBeatAt.current = now;
      void sendHeartbeat(elapsedSeconds);
    };

    lastBeatAt.current = Date.now();
    tick();

    const intervalId = window.setInterval(tick, HEARTBEAT_SECONDS * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        lastBeatAt.current = Date.now();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
