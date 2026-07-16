/**
 * Retell AI voice agent integration.
 *
 * Env vars:
 * - RETELL_API_KEY
 * - RETELL_DEFAULT_VOICE_ID (optional male override, default: 11labs-Adrian)
 * - RETELL_FEMALE_VOICE_ID (optional female override, default: 11labs-Lily)
 * - NEXT_PUBLIC_SITE_URL (for webhook URL)
 */

import { buildRetellLlmConversation } from "@/lib/integrations/retell-prompt";
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
import type {
  SpeakingPace,
  VoiceAssistantSettings,
} from "@/types/voice-assistant";

type RetellTool = Record<string, unknown> & { name: string };

const DEFAULT_MALE_VOICE_ID = "11labs-Adrian";
const DEFAULT_FEMALE_VOICE_ID = "11labs-Lily";

function resolveVoiceId(gender: VoiceAssistantSettings["voice_gender"]): string {
  if (gender === "female") {
    return process.env.RETELL_FEMALE_VOICE_ID ?? DEFAULT_FEMALE_VOICE_ID;
  }
  return process.env.RETELL_DEFAULT_VOICE_ID ?? DEFAULT_MALE_VOICE_ID;
}

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

/** Retell voice_speed is [0.5, 2]. Deltas must be wide enough to hear on a phone call. */
const PACE_TO_VOICE_SPEED: Record<SpeakingPace, number> = {
  slow: 0.72,
  normal: 1,
  energetic: 1.35,
};

/** How quickly the agent takes the turn after the caller stops. */
const PACE_TO_RESPONSIVENESS: Record<SpeakingPace, number> = {
  slow: 0.45,
  normal: 0.7,
  energetic: 0.9,
};

const PACE_TO_REMINDER_MS: Record<SpeakingPace, number> = {
  slow: 18000,
  normal: 14000,
  energetic: 10000,
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

function buildToolCatalog(settings: VoiceAssistantSettings): {
  toolsByName: Map<string, RetellTool>;
  hasOfficeTransfer: boolean;
  hasEmergencyTransfer: boolean;
} {
  const toolsByName = new Map<string, RetellTool>();

  toolsByName.set("end_call", {
    type: "end_call",
    name: "end_call",
    description: "End the call after a natural goodbye.",
  });

  const churchNumber = toE164(settings.church_phone);
  if (churchNumber) {
    toolsByName.set("transfer_to_church_office", {
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
    toolsByName.set("transfer_emergency", {
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

  return {
    toolsByName,
    hasOfficeTransfer: toolsByName.has("transfer_to_church_office"),
    hasEmergencyTransfer: toolsByName.has("transfer_emergency"),
  };
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
  const { toolsByName, hasOfficeTransfer, hasEmergencyTransfer } =
    buildToolCatalog(settings);

  const conversation = buildRetellLlmConversation(settings, context, church, {
    hasOfficeTransfer,
    hasEmergencyTransfer,
  });

  const assistantName = settings.assistant_name?.trim() || "Assistant";

  const states = conversation.states.map((state) => {
    const tools = (state.toolNames ?? [])
      .map((name) => toolsByName.get(name))
      .filter((tool): tool is RetellTool => Boolean(tool));

    return {
      name: state.name,
      state_prompt: state.state_prompt,
      ...(state.edges && state.edges.length > 0 ? { edges: state.edges } : {}),
      ...(tools.length > 0 ? { tools } : {}),
    };
  });

  const stateNames = new Set(states.map((s) => s.name));
  const statesWithValidEdges = states.map((state) => {
    if (!("edges" in state) || !state.edges) return state;
    const edges = state.edges.filter((edge) =>
      stateNames.has(edge.destination_state_name),
    );
    const { edges: _removed, ...rest } = state;
    return {
      ...rest,
      ...(edges.length > 0 ? { edges } : {}),
    };
  });

  return {
    general_prompt: conversation.general_prompt,
    begin_message: conversation.begin_message,
    starting_state: conversation.starting_state,
    states: statesWithValidEdges,
    // Tools live on the states that own them so the main conversation path
    // does not over-offer transfers or hangups.
    general_tools: [] as RetellTool[],
    default_dynamic_variables: {
      church_id: settings.church_id,
      church_name: church.name,
      assistant_name: assistantName,
    },
  };
}

function buildAgentPayload(
  llmId: string,
  settings: VoiceAssistantSettings,
  churchName: string,
) {
  const webhookUrl = getWebhookUrl();
  const pace: SpeakingPace = settings.speaking_pace ?? "normal";

  return {
    response_engine: {
      type: "retell-llm",
      llm_id: llmId,
    },
    agent_name: `${churchName} — ${settings.assistant_name?.trim() || "Voice Assistant"}`,
    voice_id: resolveVoiceId(settings.voice_gender),
    language: LANGUAGE_TO_RETELL[settings.language] ?? "en-US",
    voice_speed: PACE_TO_VOICE_SPEED[pace],
    // Keep the admin-chosen pace; don't let Retell drift the TTS rate mid-call.
    enable_dynamic_voice_speed: false,
    // Church-secretary timing, scaled by speaking pace.
    responsiveness: PACE_TO_RESPONSIVENESS[pace],
    enable_dynamic_responsiveness: pace === "normal",
    interruption_sensitivity: 0.7,
    enable_backchannel: true,
    backchannel_frequency: pace === "slow" ? 0.4 : 0.55,
    backchannel_words: ["mm-hmm", "okay", "sure", "I see"],
    reminder_trigger_ms: PACE_TO_REMINDER_MS[pace],
    reminder_max_count: 1,
    end_call_after_silence_ms: 60000,
    webhook_url: webhookUrl,
    webhook_events: webhookUrl ? ["call_ended", "call_analyzed"] : undefined,
  };
}

async function publishAgentVersion(agentId: string, version: number): Promise<void> {
  await retellRequest({
    method: "POST",
    path: `/publish-agent-version/${agentId}`,
    body: { version },
  });
}

async function publishAgent(agentId: string): Promise<void> {
  // get-agent returns the current draft; publish that version in place.
  const agent = await retellRequest<RetellAgentResponse>({
    method: "GET",
    path: `/get-agent/${agentId}`,
  });

  const version = typeof agent.version === "number" ? agent.version : null;
  if (version == null) {
    // Legacy fallback for older Retell accounts.
    await retellRequest({
      method: "POST",
      path: `/publish-agent/${agentId}`,
      body: {},
    });
    return;
  }

  await publishAgentVersion(agentId, version);
}

/**
 * Published Retell agents/LLMs are immutable. Creating an agent draft also
 * creates a matching unpublished LLM draft we can PATCH with ?version=.
 */
async function ensureDraftAgent(
  agentId: string,
): Promise<{ agentVersion: number; llmVersion: number | null }> {
  const agent = await retellRequest<RetellAgentResponse>({
    method: "GET",
    path: `/get-agent/${agentId}`,
  });

  const currentVersion = typeof agent.version === "number" ? agent.version : null;
  if (currentVersion == null) {
    throw new Error("Retell agent is missing a version number.");
  }

  const draft =
    agent.is_published === false
      ? agent
      : await retellRequest<RetellAgentResponse>({
          method: "POST",
          path: `/create-agent-version/${agentId}`,
          body: { base_version: currentVersion },
        });

  const agentVersion = typeof draft.version === "number" ? draft.version : currentVersion;
  const llmVersion =
    typeof draft.response_engine?.version === "number"
      ? draft.response_engine.version
      : null;

  return { agentVersion, llmVersion };
}

async function syncLlm(
  settings: VoiceAssistantSettings,
  context: Awaited<ReturnType<typeof getVoiceAssistantContext>>,
  church: NonNullable<Awaited<ReturnType<typeof getChurchProfileForVoice>>>,
  llmVersion?: number | null,
): Promise<string> {
  const payload = buildLlmPayload(settings, context, church);

  if (settings.retell_llm_id) {
    const versionQuery =
      typeof llmVersion === "number" ? `?version=${llmVersion}` : "";
    await retellRequest({
      method: "PATCH",
      path: `/update-retell-llm/${settings.retell_llm_id}${versionQuery}`,
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
  agentVersion?: number | null,
): Promise<string> {
  const payload = buildAgentPayload(llmId, settings, churchName);

  if (settings.retail_ai_agent_id) {
    const versionQuery =
      typeof agentVersion === "number" ? `?version=${agentVersion}` : "";
    const updated = await retellRequest<RetellAgentResponse>({
      method: "PATCH",
      path: `/update-agent/${settings.retail_ai_agent_id}${versionQuery}`,
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

export type RetellSyncResult = {
  agentId: string;
  llmId: string;
};

export async function syncRetellAgent(churchId: string): Promise<RetellSyncResult | null> {
  if (!isRetellConfigured()) return null;

  const settings = await getVoiceAssistantSettings(churchId);
  if (!settings) return null;

  const [context, church] = await Promise.all([
    getVoiceAssistantContext(churchId),
    getChurchProfileForVoice(churchId),
  ]);

  if (!church) {
    throw new Error("Church profile not found.");
  }

  let llmVersion: number | null = null;
  let agentVersion: number | null = null;

  // Existing published agents cannot be patched in place — open a draft first.
  if (settings.retail_ai_agent_id && settings.retell_llm_id) {
    const draft = await ensureDraftAgent(settings.retail_ai_agent_id);
    agentVersion = draft.agentVersion;
    llmVersion = draft.llmVersion;
  }

  const llmId = await syncLlm(settings, context, church, llmVersion);
  const agentId = await syncAgent(settings, llmId, church.name, agentVersion);

  if (typeof agentVersion === "number") {
    await publishAgentVersion(agentId, agentVersion);
  } else {
    await publishAgent(agentId);
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("voice_assistant_settings")
    .update({
      retell_llm_id: llmId,
      retail_ai_agent_id: agentId,
      agent_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("church_id", churchId);

  if (error) throw error;

  return { agentId, llmId };
}

/** @deprecated Use syncRetellAgent */
export const syncRetailAiAgent = syncRetellAgent;
