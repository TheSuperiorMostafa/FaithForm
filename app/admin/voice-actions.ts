"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { saveChurchRetellKey } from "@/lib/integrations/retell-key";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AgentMode } from "@/types/voice-assistant";

export type VoiceAgentFormState = {
  ok: boolean;
  error?: string;
};

/**
 * Links or unlinks a church's voice assistant from a Retell agent that was
 * hand-built directly in Retell, before FaithForm existed.
 *
 * Linking sets `agent_mode = 'linked'` and stores the agent id (upserting
 * `voice_assistant_settings` if the church has never saved settings before),
 * plus an optional per-church Retell API key for when the agent lives in the
 * church's own Retell account rather than FaithForm's. From then on,
 * `syncRetellAgent` and phone provisioning both refuse to touch the agent —
 * only read paths (call import, webhook ingest, scoring) keep working.
 *
 * Unlinking flips the mode back to 'managed', which resumes FaithForm
 * overwriting the agent's prompt and configuration from Church Profile on
 * the next save.
 */
export async function saveVoiceAgentLink(
  _prev: VoiceAgentFormState,
  formData: FormData,
): Promise<VoiceAgentFormState> {
  await requireSuperAdmin();

  const churchId = formData.get("church_id")?.toString();
  if (!churchId) return { ok: false, error: "Missing church." };

  const mode = formData.get("agent_mode")?.toString() as AgentMode | undefined;
  if (mode !== "managed" && mode !== "linked") {
    return { ok: false, error: "Invalid agent mode." };
  }

  const admin = createAdminClient();

  if (mode === "linked") {
    const agentId = formData.get("retell_agent_id")?.toString().trim();
    if (!agentId) {
      return { ok: false, error: "Retell agent ID is required to link." };
    }

    const { error } = await admin.from("voice_assistant_settings").upsert(
      {
        church_id: churchId,
        retail_ai_agent_id: agentId,
        agent_mode: "linked",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    );

    if (error) return { ok: false, error: error.message };

    const apiKey = formData.get("retell_api_key")?.toString().trim();
    if (apiKey) {
      try {
        await saveChurchRetellKey(churchId, apiKey, admin);
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : "Agent linked, but could not save the Retell API key.",
        };
      }
    }
  } else {
    const { error } = await admin
      .from("voice_assistant_settings")
      .update({ agent_mode: "managed", updated_at: new Date().toISOString() })
      .eq("church_id", churchId);

    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/churches/${churchId}`);
  revalidatePath("/dashboard/voice-assistant");
  revalidatePath("/dashboard");

  return { ok: true };
}
