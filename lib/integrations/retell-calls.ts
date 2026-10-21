import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logPhoneCallActivity } from "@/lib/activity/log";
import { retellRequest } from "@/lib/integrations/retell-client";
import { isRealRetellPhoneCall, type RetellCallEvent } from "@/lib/integrations/retell-call-model";
import { scorePhoneCallIfNeeded } from "@/lib/integrations/score-phone-call";
import { createAdminClient } from "@/lib/supabase/admin";
import { phoneCallMinutesSaved } from "@/lib/utils/phone-call-time-saved";

export type RetellCallPayload = {
  call_id: string;
  agent_id?: string;
  call_type?: "phone_call" | "web_call";
  direction?: "inbound" | "outbound";
  call_status?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  disconnection_reason?: string;
  transcript?: string;
  recording_url?: string;
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
  phoneCallId: string;
};

function readChurchIdFromCall(_call: RetellCallPayload): string | null {
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

export function buildPhoneCallRow(churchId: string, call: RetellCallPayload, event: RetellCallEvent = "call_ended") {
  const durationSeconds =
    call.start_timestamp != null && call.end_timestamp != null
      ? Math.max(
          0,
          Math.round((call.end_timestamp - call.start_timestamp) / 1000),
        )
      : null;

  return {
    church_id: churchId,
    retail_ai_call_id: call.call_id,
    caller_number: (call.direction === "outbound" ? call.to_number : call.from_number) ?? null,
    ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {}),
    ...(formatOutcome(call) ? { outcome: formatOutcome(call) } : {}),
    ...(call.call_analysis?.user_sentiment ? { sentiment: call.call_analysis.user_sentiment } : {}),
    ...(call.transcript ? { transcript: call.transcript } : {}),
    ...(call.recording_url ? { recording_url: call.recording_url } : {}),
    ...(typeof call.call_analysis?.call_successful === "boolean"
      ? { call_successful: call.call_analysis.call_successful } : {}),
    ...(call.call_analysis?.call_summary ? { notes: call.call_analysis.call_summary } : {}),
    call_type: call.direction ?? "inbound",
    provider_call_type: call.call_type,
    call_status: event === "call_started" ? "ongoing" : event === "call_analyzed" ? "analyzed" : "ended",
    called_at: call.start_timestamp != null
      ? new Date(call.start_timestamp).toISOString()
      : call.end_timestamp != null ? new Date(call.end_timestamp).toISOString()
      : new Date().toISOString(),
  };
}

export async function upsertPhoneCallFromRetell(
  call: RetellCallPayload,
  admin?: SupabaseClient,
  options: { event?: RetellCallEvent; score?: boolean } = {},
): Promise<UpsertRetellCallResult | null> {
  if (!isRealRetellPhoneCall(call)) return null;
  const client = admin ?? createAdminClient();
  const churchId = await resolveChurchIdFromRetellCall(call, client);
  if (!churchId) return null;

  const event = options.event ?? (call.call_analysis ? "call_analyzed" : "call_ended");
  const row = buildPhoneCallRow(churchId, call, event);

  // Looked up inside the church the call was verified for. Found across all
  // churches, a church holding its own Retell key could sign a payload naming
  // another church's call id and move that call — transcript and caller's
  // number — into its own account.
  const { data: existing } = await client
    .from("phone_calls")
    .select("id")
    .eq("retail_ai_call_id", call.call_id)
    .eq("church_id", churchId)
    .maybeSingle();

  const minutesSaved = phoneCallMinutesSaved(row.duration_seconds);
  const executedAt = row.called_at as string;

  let phoneCallId = existing?.id as string | undefined;

  if (phoneCallId) {
    const { error } = await client.from("phone_calls").update(row).eq("id", phoneCallId).eq("church_id", churchId);
    if (error) throw error;
  } else {
    const { data: inserted, error } = await client
      .from("phone_calls")
      .insert(row)
      .select("id")
      .single();

    if (error?.code === "23505") {
      // A simultaneous lifecycle webhook inserted first. Never move a call
      // from another tenant when retrying a provider-wide unique call id.
      const { data: raced } = await client.from("phone_calls").select("id")
        .eq("retail_ai_call_id", call.call_id).eq("church_id", churchId).maybeSingle();
      if (!raced?.id) throw error;
      phoneCallId = raced.id as string;
      const updated = await client.from("phone_calls").update(row).eq("id", phoneCallId).eq("church_id", churchId);
      if (updated.error) throw updated.error;
    } else {
      if (error) throw error;
      phoneCallId = inserted.id as string;
    }
  }

  if (event !== "call_started") await logPhoneCallActivity({
    churchId,
    phoneCallId,
    retailAiCallId: call.call_id,
    callerNumber: row.caller_number,
    durationSeconds: row.duration_seconds ?? null,
    executedAt,
    timeSavedMinutes: minutesSaved,
  }, client);

  if (options.score !== false && event !== "call_started" && phoneCallId && row.transcript) {
    await scorePhoneCallIfNeeded(phoneCallId, { admin: client });
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/voice-assistant");
  revalidatePath("/dashboard/call-log");
  if (phoneCallId) {
    revalidatePath(`/dashboard/call-log/${phoneCallId}`);
  }

  return { churchId, phoneCallId, created: !existing?.id };
}

type RetellListCallsResponse = {
  items?: RetellCallPayload[];
  has_more?: boolean;
  pagination_key?: string | null;
};

const RETELL_CALL_PAGE_LIMIT = 50;
const RETELL_CALL_PAGE_CAP = 20;

export async function importRetellCallsForChurch(
  churchId: string,
  limit = 50,
  options: { admin?: SupabaseClient; score?: boolean; signal?: AbortSignal } = {},
): Promise<{ imported: number; skipped: number }> {
  const admin = options.admin ?? createAdminClient();
  const { data: settings } = await admin
    .from("voice_assistant_settings")
    .select("retail_ai_agent_id")
    .eq("church_id", churchId)
    .maybeSingle();

  const agentId = settings?.retail_ai_agent_id as string | undefined;
  if (!agentId) {
    throw new Error("No Retell agent linked yet. Save your voice assistant settings first.");
  }

  const calls: RetellCallPayload[] = [];
  let paginationKey: string | undefined;
  let remaining = Math.max(0, limit);

  for (
    let page = 0;
    page < RETELL_CALL_PAGE_CAP && remaining > 0;
    page += 1
  ) {
    const pageLimit = Math.min(remaining, RETELL_CALL_PAGE_LIMIT);
    options.signal?.throwIfAborted();
    const response = await retellRequest<RetellListCallsResponse>({
      method: "POST",
      path: "/v3/list-calls",
      body: {
        filter_criteria: {
          agent: [{ agent_id: agentId }],
        },
        sort_order: "descending",
        limit: pageLimit,
        ...(paginationKey ? { pagination_key: paginationKey } : {}),
      },
      // A linked church's agent may live in their own Retell account, so calls
      // are listed with their key when one is saved, falling back to
      // FaithForm's shared key.
      churchId,
      admin,
      signal: options.signal,
    });

    if (!Array.isArray(response?.items)) throw new Error("Retell returned an invalid call list.");
    const pageItems = response.items;
    calls.push(...pageItems);
    remaining -= pageItems.length;

    if (!response?.has_more || !response.pagination_key) break;
    paginationKey = response.pagination_key;
  }

  let imported = 0;
  let skipped = 0;

  for (const call of calls ?? []) {
    options.signal?.throwIfAborted();
    if (!call.call_id || !isRealRetellPhoneCall(call)) { skipped += 1; continue; }
    const detail = await retellRequest<RetellCallPayload>({ method: "GET", path: `/v2/get-call/${encodeURIComponent(call.call_id)}`, churchId, admin, signal: options.signal });
    if (detail.agent_id !== agentId) throw new Error("Retell returned a call for another agent.");
    const result = await upsertPhoneCallFromRetell(detail, admin, {
      event: detail.call_status === "ongoing" ? "call_started" : detail.call_analysis ? "call_analyzed" : "call_ended",
      score: options.score,
    });
    if (!result) {
      skipped += 1;
      continue;
    }
    if (result.created) imported += 1;
  }

  return { imported, skipped };
}
