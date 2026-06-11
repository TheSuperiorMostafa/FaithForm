import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logPhoneCallActivity } from "@/lib/activity/log";
import { retellRequest } from "@/lib/integrations/retell-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { phoneCallMinutesSaved } from "@/lib/utils/phone-call-time-saved";

export type RetellCallPayload = {
  call_id: string;
  agent_id?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  disconnection_reason?: string;
  transcript?: string;
  call_analysis?: {
    user_sentiment?: string;
    call_summary?: string;
    call_successful?: boolean;
  };
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, string>;
};

export type UpsertRetellCallResult = {
  churchId: string;
  created: boolean;
};

function readChurchIdFromCall(call: RetellCallPayload): string | null {
  const metadataId = call.metadata?.church_id;
  if (typeof metadataId === "string" && metadataId) return metadataId;

  const dynamicId = call.retell_llm_dynamic_variables?.church_id;
  if (dynamicId) return dynamicId;

  return null;
}

export async function resolveChurchIdFromRetellCall(
  call: RetellCallPayload,
  admin?: SupabaseClient,
): Promise<string | null> {
  const fromPayload = readChurchIdFromCall(call);
  if (fromPayload) return fromPayload;

  if (!call.agent_id) return null;

  const client = admin ?? createAdminClient();
  const { data } = await client
    .from("voice_assistant_settings")
    .select("church_id")
    .eq("retail_ai_agent_id", call.agent_id)
    .maybeSingle();

  return (data?.church_id as string | undefined) ?? null;
}

function formatOutcome(call: RetellCallPayload): string | null {
  const summary = call.call_analysis?.call_summary?.trim();
  if (summary) return summary;
  return call.disconnection_reason ?? null;
}

export function buildPhoneCallRow(churchId: string, call: RetellCallPayload) {
  const durationSeconds =
    call.start_timestamp && call.end_timestamp
      ? Math.max(
          0,
          Math.round((call.end_timestamp - call.start_timestamp) / 1000),
        )
      : null;

  return {
    church_id: churchId,
    retail_ai_call_id: call.call_id,
    caller_number: call.from_number ?? null,
    duration_seconds: durationSeconds,
    outcome: formatOutcome(call),
    sentiment: call.call_analysis?.user_sentiment ?? null,
    transcript: call.transcript ?? null,
    notes: call.call_analysis?.call_summary ?? null,
    call_type: "inbound",
    called_at: call.end_timestamp
      ? new Date(call.end_timestamp).toISOString()
      : new Date().toISOString(),
  };
}

export async function upsertPhoneCallFromRetell(
  call: RetellCallPayload,
  admin?: SupabaseClient,
): Promise<UpsertRetellCallResult | null> {
  const client = admin ?? createAdminClient();
  const churchId = await resolveChurchIdFromRetellCall(call, client);
  if (!churchId) return null;

  const row = buildPhoneCallRow(churchId, call);

  const { data: existing } = await client
    .from("phone_calls")
    .select("id")
    .eq("retail_ai_call_id", call.call_id)
    .maybeSingle();

  const minutesSaved = phoneCallMinutesSaved(row.duration_seconds);
  const executedAt = row.called_at as string;

  if (existing?.id) {
    await client.from("phone_calls").update(row).eq("id", existing.id);
    revalidatePath("/dashboard");
    return { churchId, created: false };
  }

  const { data: inserted, error } = await client
    .from("phone_calls")
    .insert(row)
    .select("id")
    .single();

  if (error) throw error;

  await logPhoneCallActivity({
    churchId,
    phoneCallId: inserted.id as string,
    retailAiCallId: call.call_id,
    callerNumber: call.from_number ?? null,
    durationSeconds: row.duration_seconds,
    executedAt,
    timeSavedMinutes: minutesSaved,
  });

  revalidatePath("/dashboard");

  return { churchId, created: true };
}

type RetellListCallsResponse = Array<RetellCallPayload>;

export async function importRetellCallsForChurch(
  churchId: string,
  limit = 50,
): Promise<{ imported: number; skipped: number }> {
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("voice_assistant_settings")
    .select("retail_ai_agent_id")
    .eq("church_id", churchId)
    .maybeSingle();

  const agentId = settings?.retail_ai_agent_id as string | undefined;
  if (!agentId) {
    throw new Error("No Retell agent linked yet. Save your voice assistant settings first.");
  }

  const calls = await retellRequest<RetellListCallsResponse>({
    method: "POST",
    path: "/v2/list-calls",
    body: {
      filter_criteria: {
        agent_id: [agentId],
      },
      sort_order: "descending",
      limit,
    },
  });

  let imported = 0;
  let skipped = 0;

  for (const call of calls ?? []) {
    if (!call.call_id) continue;
    const result = await upsertPhoneCallFromRetell(call, admin);
    if (!result) {
      skipped += 1;
      continue;
    }
    if (result.created) imported += 1;
  }

  return { imported, skipped };
}
