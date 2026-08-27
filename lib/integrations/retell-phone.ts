import {
  isRetellConfigured,
  publishCurrentAgentDraft,
  RetellLinkedAgentError,
  syncRetellAgent,
} from "@/lib/integrations/retell";
import {
  RetellApiError,
  retellRequest,
} from "@/lib/integrations/retell-client";
import { hasChurchRetellKey } from "@/lib/integrations/retell-key";
import { getVoiceAssistantSettings } from "@/lib/queries/voice-assistant";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A linked church may only have its own Retell key, never FaithForm's shared
 * `RETELL_API_KEY` — so "Retell isn't set up" has to check both before
 * refusing.
 */
async function isRetellUsableForChurch(churchId: string): Promise<boolean> {
  if (isRetellConfigured()) return true;
  return hasChurchRetellKey(churchId);
}

export type RetellPhoneNumber = {
  phone_number: string;
  phone_number_pretty?: string;
  nickname?: string | null;
  inbound_agents?: Array<{ agent_id: string; weight: number }> | null;
};

type ListPhoneNumbersResponse =
  | RetellPhoneNumber[]
  | {
      items?: RetellPhoneNumber[];
    };

function formatDisplayNumber(phone: RetellPhoneNumber): string {
  return phone.phone_number_pretty?.trim() || phone.phone_number;
}

async function listRetellPhoneNumbers(
  churchId?: string | null,
): Promise<RetellPhoneNumber[]> {
  const response = await retellRequest<ListPhoneNumbersResponse>({
    method: "GET",
    path: "/v2/list-phone-numbers",
    churchId,
  });

  if (Array.isArray(response)) return response;
  return response.items ?? [];
}

function findNumberForAgent(
  numbers: RetellPhoneNumber[],
  agentId: string,
): RetellPhoneNumber | null {
  return (
    numbers.find((n) =>
      n.inbound_agents?.some((agent) => agent.agent_id === agentId),
    ) ?? null
  );
}

async function saveChurchPhoneNumber(
  churchId: string,
  phoneNumber: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("voice_assistant_settings")
    .update({
      retail_ai_phone_number: phoneNumber?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("church_id", churchId);

  if (error) throw error;
}

export type ProvisionPhoneResult = {
  phoneNumber: string;
  created: boolean;
};

/**
 * Ensure the church has a Retell dial-in number bound to its agent.
 * Reuses an existing bound number when possible; otherwise buys a new one.
 */
export async function provisionRetellPhoneForChurch(
  churchId: string,
  options: { areaCode?: number } = {},
): Promise<ProvisionPhoneResult> {
  if (!(await isRetellUsableForChurch(churchId))) {
    throw new Error("Retell is not configured. Set RETELL_API_KEY first.");
  }

  let settings = await getVoiceAssistantSettings(churchId);
  if (!settings) {
    throw new Error("Save your voice assistant settings before getting a number.");
  }

  if (settings.agent_mode === "linked") {
    throw new RetellLinkedAgentError(
      "This church's agent is linked from their own Retell account, so it already has its own phone setup. Manage numbers directly in Retell.",
    );
  }

  if (!settings.retail_ai_agent_id) {
    const sync = await syncRetellAgent(churchId);
    if (!sync?.agentId) {
      throw new Error(
        "Could not create your Retell agent. Save settings and try again.",
      );
    }
    settings = await getVoiceAssistantSettings(churchId);
  }

  const agentId = settings?.retail_ai_agent_id;
  if (!settings || !agentId) {
    throw new Error("No Retell agent is linked to this church yet.");
  }

  if (settings.retail_ai_phone_number) {
    return {
      phoneNumber: settings.retail_ai_phone_number,
      created: false,
    };
  }

  const existing = findNumberForAgent(
    await listRetellPhoneNumbers(churchId),
    agentId,
  );
  if (existing) {
    const display = formatDisplayNumber(existing);
    await saveChurchPhoneNumber(churchId, display);
    return { phoneNumber: display, created: false };
  }

  const churchName =
    settings.assistant_name?.trim() || "FaithForm Voice Assistant";

  const body: Record<string, unknown> = {
    nickname: `${churchName} line`,
    country_code: "US",
    inbound_agents: [
      {
        agent_id: agentId,
        agent_version: "latest_published",
        weight: 1,
      },
    ],
  };

  if (
    typeof options.areaCode === "number" &&
    options.areaCode >= 200 &&
    options.areaCode <= 999
  ) {
    body.area_code = options.areaCode;
  }

  try {
    // Make sure the latest draft is published before inbound calls can use it.
    await publishCurrentAgentDraft(agentId, undefined, churchId);

    const created = await retellRequest<RetellPhoneNumber>({
      method: "POST",
      path: "/create-phone-number",
      body,
      churchId,
    });

    const display = formatDisplayNumber(created);
    await saveChurchPhoneNumber(churchId, display);

    // Keep binding pinned to published version (avoids draft-only agents).
    await retellRequest({
      method: "PATCH",
      path: `/update-phone-number/${encodeURIComponent(created.phone_number)}`,
      body: {
        inbound_agents: [
          {
            agent_id: agentId,
            agent_version: "latest_published",
            weight: 1,
          },
        ],
      },
      churchId,
    });

    return { phoneNumber: display, created: true };
  } catch (err) {
    if (err instanceof RetellApiError) {
      const bodyLower = err.body.toLowerCase();
      if (
        bodyLower.includes("payment") ||
        bodyLower.includes("billing") ||
        bodyLower.includes("no_valid_payment")
      ) {
        throw new Error(
          "Retell billing issue: add a valid payment method in the Retell dashboard, then try again.",
        );
      }
      throw new Error(
        `Could not buy a phone number from Retell (${err.status}). ${err.body || err.message}`,
      );
    }
    throw err;
  }
}

/** Refresh the dial-in number from Retell for this church's agent. */
export async function syncRetellPhoneForChurch(
  churchId: string,
): Promise<string | null> {
  if (!(await isRetellUsableForChurch(churchId))) {
    throw new Error("Retell is not configured. Set RETELL_API_KEY first.");
  }

  const settings = await getVoiceAssistantSettings(churchId);
  const agentId = settings?.retail_ai_agent_id;
  if (!agentId) {
    throw new Error("No Retell agent is linked yet. Save settings first.");
  }

  const match = findNumberForAgent(
    await listRetellPhoneNumbers(churchId),
    agentId,
  );
  if (!match) {
    await saveChurchPhoneNumber(churchId, null);
    return null;
  }

  const display = formatDisplayNumber(match);
  await saveChurchPhoneNumber(churchId, display);
  return display;
}
