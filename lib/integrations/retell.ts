/**
 * Retell AI voice agent integration.
 *
 * Env vars:
 * - RETELL_API_KEY
 * - RETELL_DEFAULT_VOICE_ID (optional, default: 11labs-Adrian)
 * - NEXT_PUBLIC_SITE_URL (for webhook URL)
 */

import { buildRetellGeneralPrompt } from "@/lib/integrations/retell-prompt";
import {
  retellRequest,
  type RetellAgentResponse,
  type RetellLlmResponse,
} from "@/lib/integrations/retell-client";
import {
  getChurchProfileForVoice,
  getVoiceAssistantContext,
  getVoiceAssistantSettings,
} from "@/lib/queries/voice-assistant";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VoiceAssistantSettings } from "@/types/voice-assistant";

const DEFAULT_VOICE_ID = "11labs-Adrian";

const LANGUAGE_TO_RETELL: Record<string, string> = {
  en: "en-US",
  es: "es-ES",
  zh: "zh-CN",
  ar: "ar-SA",
  hi: "hi-IN",
  fr: "fr-FR",
  pt: "pt-BR",
  ru: "ru-RU",
  de: "de-DE",
  ko: "ko-KR",
};

const PACE_TO_VOICE_SPEED: Record<string, number> = {
  slow: 0.85,
  normal: 1,
  energetic: 1.2,
};

export function isRetellConfigured(): boolean {
  return Boolean(process.env.RETELL_API_KEY);
}

/** @deprecated Use isRetellConfigured */
export function isRetailAiConfigured(): boolean {
  return isRetellConfigured();
}

function toE164(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

function buildTransferTools(settings: VoiceAssistantSettings) {
  const tools: Record<string, unknown>[] = [
    {
      type: "end_call",
      name: "end_call",
      description: "End the call after helping the caller.",
    },
  ];

  const churchNumber = toE164(settings.church_phone);
  if (churchNumber) {
    tools.push({
      type: "transfer_call",
      name: "transfer_to_church_office",
      description:
        "Transfer the caller to the church office when they ask to speak with a real person, pastor, or staff member.",
      transfer_destination: {
        type: "predefined",
        number: churchNumber,
      },
      transfer_option: {
        type: "cold_transfer",
        show_transferee_as_caller: false,
      },
    });
  }

  const emergencyNumber = toE164(settings.emergency_phone);
  if (emergencyNumber) {
    tools.push({
      type: "transfer_call",
      name: "transfer_emergency",
      description:
        "Transfer immediately for crisis, emergency, suicide risk, abuse, or urgent pastoral care.",
      transfer_destination: {
        type: "predefined",
        number: emergencyNumber,
      },
      transfer_option: {
        type: "cold_transfer",
        show_transferee_as_caller: false,
      },
    });
  }

  return tools;
}

function getWebhookUrl(): string | null {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (!siteUrl) return null;
  return `${siteUrl}/api/webhooks/retell`;
}

function buildLlmPayload(
  settings: VoiceAssistantSettings,
  context: Awaited<ReturnType<typeof getVoiceAssistantContext>>,
  church: NonNullable<Awaited<ReturnType<typeof getChurchProfileForVoice>>>,
) {
  return {
    general_prompt: buildRetellGeneralPrompt(settings, context, church),
    begin_message: settings.greeting_message?.trim() || undefined,
    general_tools: buildTransferTools(settings),
    default_dynamic_variables: {
      church_id: settings.church_id,
      church_name: church.name,
      assistant_name: settings.assistant_name?.trim() || "Assistant",
    },
  };
}

function buildAgentPayload(
  llmId: string,
  settings: VoiceAssistantSettings,
  churchName: string,
) {
  const voiceId = process.env.RETELL_DEFAULT_VOICE_ID ?? DEFAULT_VOICE_ID;
  const webhookUrl = getWebhookUrl();

  return {
    response_engine: {
      type: "retell-llm",
      llm_id: llmId,
    },
    agent_name: `${churchName} — ${settings.assistant_name?.trim() || "Voice Assistant"}`,
    voice_id: voiceId,
    language: LANGUAGE_TO_RETELL[settings.language] ?? "en-US",
    voice_speed: PACE_TO_VOICE_SPEED[settings.speaking_pace] ?? 1,
    webhook_url: webhookUrl,
    webhook_events: webhookUrl ? ["call_analyzed"] : undefined,
  };
}

async function syncLlm(
  settings: VoiceAssistantSettings,
  context: Awaited<ReturnType<typeof getVoiceAssistantContext>>,
  church: NonNullable<Awaited<ReturnType<typeof getChurchProfileForVoice>>>,
): Promise<string> {
  const payload = buildLlmPayload(settings, context, church);

  if (settings.retell_llm_id) {
    await retellRequest({
      method: "PATCH",
      path: `/update-retell-llm/${settings.retell_llm_id}`,
      body: payload,
    });
    return settings.retell_llm_id;
  }

  const created = await retellRequest<RetellLlmResponse>({
    method: "POST",
    path: "/create-retell-llm",
    body: payload,
  });

  return created.llm_id;
}

async function syncAgent(
  settings: VoiceAssistantSettings,
  llmId: string,
  churchName: string,
): Promise<string> {
  const payload = buildAgentPayload(llmId, settings, churchName);

  if (settings.retail_ai_agent_id) {
    const updated = await retellRequest<RetellAgentResponse>({
      method: "PATCH",
      path: `/update-agent/${settings.retail_ai_agent_id}`,
      body: payload,
    });
    return updated.agent_id ?? settings.retail_ai_agent_id;
  }

  const created = await retellRequest<RetellAgentResponse>({
    method: "POST",
    path: "/create-agent",
    body: payload,
  });

  return created.agent_id;
}

export async function syncRetellAgent(churchId: string): Promise<void> {
  if (!isRetellConfigured()) return;

  const settings = await getVoiceAssistantSettings(churchId);
  if (!settings) return;

  const [context, church] = await Promise.all([
    getVoiceAssistantContext(churchId),
    getChurchProfileForVoice(churchId),
  ]);

  if (!church) {
    console.error("[retell] church profile not found", churchId);
    return;
  }

  const llmId = await syncLlm(settings, context, church);
  const agentId = await syncAgent(settings, llmId, church.name);

  const admin = createAdminClient();
  await admin
    .from("voice_assistant_settings")
    .update({
      retell_llm_id: llmId,
      retail_ai_agent_id: agentId,
      agent_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("church_id", churchId);
}

/** @deprecated Use syncRetellAgent */
export const syncRetailAiAgent = syncRetellAgent;
