"use client";

import { useEffect, useRef } from "react";
import { autoSyncVoiceAgent } from "@/app/dashboard/voice-assistant/auto-sync";

const SESSION_KEY = "faithform:voice-agent-auto-synced";

/**
 * When the dashboard opens, quietly refresh the Retell agent from Church Profile
 * and current prompt builders — no Save click required.
 */
export function VoiceAgentAutoSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    try {
      if (typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(SESSION_KEY) === "1") return;
        sessionStorage.setItem(SESSION_KEY, "1");
      }
    } catch {
      // sessionStorage may be blocked; still attempt one sync.
    }

    void autoSyncVoiceAgent().catch(() => {
      // Best-effort — never interrupt the dashboard.
    });
  }, []);

  return null;
}
