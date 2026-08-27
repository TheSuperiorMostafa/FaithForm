"use server";

import { getChurchAuth } from "@/lib/auth/church";
import {
  isRetellConfigured,
  syncRetellAgent,
} from "@/lib/integrations/retell";
import { getVoiceAssistantSettings } from "@/lib/queries/voice-assistant";

/** Avoid hammering Retell on rapid remounts / double mounts in React Strict Mode. */
const MIN_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export type AutoSyncVoiceAgentResult =
  | { ok: true; synced: true; agentId: string }
  | { ok: true; synced: false; reason: string }
  | { ok: false; error: string };

/**
 * Best-effort Retell sync when a pastor opens the dashboard.
 * Updates begin_message / prompts from Church Profile + current code without requiring Save.
 */
export async function autoSyncVoiceAgent(): Promise<AutoSyncVoiceAgentResult> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!isRetellConfigured()) {
    return { ok: true, synced: false, reason: "retell_not_configured" };
  }

  try {
    const settings = await getVoiceAssistantSettings(auth.churchId);

    // Linked churches manage their own agent directly in Retell — never
    // push a prompt/config update to it, even a routine background one.
    if (settings?.agent_mode === "linked") {
      return { ok: true, synced: false, reason: "linked_agent" };
    }

    if (!settings?.retail_ai_agent_id || !settings.assistant_name?.trim()) {
      return { ok: true, synced: false, reason: "agent_not_provisioned" };
    }

    if (settings.agent_synced_at) {
      const syncedAt = new Date(settings.agent_synced_at).getTime();
      if (
        Number.isFinite(syncedAt) &&
        Date.now() - syncedAt < MIN_SYNC_INTERVAL_MS
      ) {
        return { ok: true, synced: false, reason: "recently_synced" };
      }
    }

    const result = await syncRetellAgent(auth.churchId);
    if (!result?.agentId) {
      return { ok: true, synced: false, reason: "sync_returned_null" };
    }

    return { ok: true, synced: true, agentId: result.agentId };
  } catch (err) {
    console.error("[voice-assistant] auto-sync failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Auto-sync failed",
    };
  }
}
