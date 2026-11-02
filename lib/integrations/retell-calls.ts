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

type RetellAgentWeight = { agent_id: string };

/** The subset of Retell's phone-number object that says which agents answer it. */
export type RetellNumberBinding = {
  phone_number: string;
  inbound_agents?: RetellAgentWeight[] | null;
  outbound_agents?: RetellAgentWeight[] | null;
};

const E164 = /^\+[1-9]\d{7,14}$/;

/** The church's own Retell number on a call: who was dialed inbound, who dialed outbound. */
export function churchSideNumber(call: RetellCallPayload): string | null {
  const number = call.direction === "outbound" ? call.from_number : call.to_number;
  const trimmed = number?.trim();
  return trimmed && E164.test(trimmed) ? trimmed : null;
}

/** Every agent a Retell number routes to, inbound or outbound. */
export function agentIdsOnNumber(binding: RetellNumberBinding): string[] {
  const ids = [...(binding.inbound_agents ?? []), ...(binding.outbound_agents ?? [])]
    .map((agent) => agent.agent_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

/**
 * A number can split its calls across several agents (an A/B weight, say),
 * but a church row stores only one. Every agent sharing a number with the
 * church's saved agent answers for that church.
 */
export function agentIdsForChurch(
  primaryAgentId: string,
  numbers: RetellNumberBinding[],
): string[] {
  const ids = new Set([primaryAgentId]);
  for (const binding of numbers) {
    const onNumber = agentIdsOnNumber(binding);
    if (onNumber.includes(primaryAgentId)) onNumber.forEach((id) => ids.add(id));
  }
  return [...ids];
}

/**
 * The church a call belongs to when its agent is not the one the church saved:
 * only when the call's agent is actually bound to the number the call used,
 * and exactly one church has saved an agent on that number.
 */
export function churchForSiblingAgent(
  call: RetellCallPayload,
  binding: RetellNumberBinding,
  rows: Array<{ church_id: string; retail_ai_agent_id: string | null }>,
): string | null {
  if (!call.agent_id) return null;
  const onNumber = agentIdsOnNumber(binding);
  if (!onNumber.includes(call.agent_id)) return null;
  const churches = new Set(
    rows
      .filter((row) => row.retail_ai_agent_id && onNumber.includes(row.retail_ai_agent_id))
      .map((row) => row.church_id),
  );
  return churches.size === 1 ? [...churches][0] : null;
}

async function churchFromCallNumber(
  call: RetellCallPayload,
  client: SupabaseClient,
): Promise<string | null> {
  const number = churchSideNumber(call);
  if (!number || !call.agent_id) return null;

  let binding: RetellNumberBinding;
  try {
    // No church is known yet, so this uses FaithForm's shared key — the
    // account the church's number lives in unless the church saved its own.
    binding = await retellRequest<RetellNumberBinding>({
      method: "GET",
      path: `/get-phone-number/${encodeURIComponent(number)}`,
    });
  } catch {
    return null;
  }

  const onNumber = agentIdsOnNumber(binding);
  if (!onNumber.includes(call.agent_id)) return null;
  const { data } = await client
    .from("voice_assistant_settings")
    .select("church_id, retail_ai_agent_id")
    .in("retail_ai_agent_id", onNumber);
  return churchForSiblingAgent(
    call,
    binding,
    (data ?? []) as Array<{ church_id: string; retail_ai_agent_id: string | null }>,
  );
}

export async function resolveChurchIdFromRetellCall(
  call: RetellCallPayload,
  admin?: SupabaseClient,
): Promise<string | null> {
  if (!call.agent_id) return null;

  const client = admin ?? createAdminClient();
  const { data } = await client
    .from("voice_assistant_settings")
    .select("church_id")
    .eq("retail_ai_agent_id", call.agent_id)
    .maybeSingle();

  const direct = (data?.church_id as string | undefined) ?? null;
  if (direct) return direct;

  // A second agent on the church's number (e.g. the 20% side of a split).
  return churchFromCallNumber(call, client);
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
  options: { event?: RetellCallEvent; score?: boolean; churchId?: string } = {},
): Promise<UpsertRetellCallResult | null> {
  if (!isRealRetellPhoneCall(call)) return null;
  const client = admin ?? createAdminClient();
  // The importer already proved the call is this church's (its agent is on the
  // church's number); the webhook still has to resolve it.
  const churchId = options.churchId ?? await resolveChurchIdFromRetellCall(call, client);
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

type ListPhoneNumbersResponse = {
  items?: RetellNumberBinding[];
  has_more?: boolean;
  pagination_key?: string | null;
};

/**
 * The church's saved agent plus every agent sharing a Retell number with it.
 * An agent another church saved is never claimed. If the numbers can't be
 * listed, import still covers the saved agent.
 */
async function listChurchAgentIds(
  churchId: string,
  primaryAgentId: string,
  admin: SupabaseClient,
  signal?: AbortSignal,
): Promise<string[]> {
  const numbers: RetellNumberBinding[] = [];
  try {
    let paginationKey: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: "1000" });
      if (paginationKey) query.set("pagination_key", paginationKey);
      const response = await retellRequest<ListPhoneNumbersResponse>({
        method: "GET",
        path: `/v2/list-phone-numbers?${query.toString()}`,
        churchId,
        admin,
        signal,
      });
      numbers.push(...(response?.items ?? []));
      if (!response?.has_more || !response.pagination_key) break;
      paginationKey = response.pagination_key;
    }
  } catch {
    signal?.throwIfAborted();
    console.warn("[retell import] could not list phone numbers; importing the saved agent only", churchId);
    return [primaryAgentId];
  }

  const ids = agentIdsForChurch(primaryAgentId, numbers);
  if (ids.length === 1) return ids;
  const { data } = await admin
    .from("voice_assistant_settings")
    .select("church_id, retail_ai_agent_id")
    .in("retail_ai_agent_id", ids);
  const claimedElsewhere = new Set(
    ((data ?? []) as Array<{ church_id: string; retail_ai_agent_id: string | null }>)
      .filter((row) => row.church_id !== churchId && row.retail_ai_agent_id)
      .map((row) => row.retail_ai_agent_id as string),
  );
  return ids.filter((id) => !claimedElsewhere.has(id));
}

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

  const agentIds = await listChurchAgentIds(churchId, agentId, admin, options.signal);

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
          agent: agentIds.map((id) => ({ agent_id: id })),
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
    if (!detail.agent_id || !agentIds.includes(detail.agent_id)) throw new Error("Retell returned a call for another agent.");
    const result = await upsertPhoneCallFromRetell(detail, admin, {
      churchId,
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
