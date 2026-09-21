import { createHash, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DM_CHANNEL_TYPE, GROUP_CHANNEL_TYPE, SYSTEM_CHAT_USER_ID, isChatUserId } from "@/lib/messaging/ids";
import type { ChatProvider } from "@/lib/messaging/provider";
import { getChatProvider } from "@/lib/messaging/stream-provider";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Inbound provider events.
 *
 * Trusted only after three checks, in order: the request names our app key,
 * the body carries a valid HMAC-SHA256 signature made with our app secret
 * (compared in constant time), and the event id has not been seen. Anything
 * else is refused before its body is parsed.
 *
 * What an event may do is deliberately small. It can count a message, open an
 * automatic report, audit a leader's deletion, or *enqueue a reconcile* —
 * never change who belongs anywhere. So a forged or replayed event that got
 * through would at worst cause FaithForm to re-check what it already knows.
 *
 * Retries carry the same `X-Webhook-Id`; claiming that id is the first write,
 * and a duplicate stops there. Out-of-order delivery is harmless for the same
 * reason reconciles are: every write here is a count or a request to look
 * again at current state.
 */

export const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export type WebhookResult = {
  status: number;
  body: { received: boolean; duplicate?: boolean; error?: string };
};

type StreamUser = { id?: string; name?: string } | null | undefined;

type StreamEvent = {
  type?: string;
  cid?: string;
  channel_id?: string;
  channel_type?: string;
  user?: StreamUser;
  created_at?: string;
  message?: {
    id?: string;
    text?: string;
    created_at?: string;
    user?: StreamUser;
    attachments?: unknown[];
    parent_id?: string;
  } | null;
  target_user?: StreamUser;
  reason?: string;
};

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Stream may gzip a body; the signature covers the uncompressed bytes. */
function decode(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    return gunzipSync(raw, { maxOutputLength: MAX_WEBHOOK_BYTES }).toString("utf8");
  }
  return raw.toString("utf8");
}

function channelOf(event: StreamEvent): { type: string; id: string } | null {
  const type = event.channel_type ?? event.cid?.split(":")[0];
  const id = event.channel_id ?? event.cid?.split(":")[1];
  if (!type || !id) return null;
  return { type, id };
}

async function authUserFor(admin: SupabaseClient, chatUserId: string | undefined): Promise<string | null> {
  if (!chatUserId || !isChatUserId(chatUserId)) return null;
  const { data } = await admin
    .from("messaging_user_bindings")
    .select("user_id")
    .eq("chat_user_id", chatUserId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

type ChannelContext = { churchId: string; groupId: string | null; dmRowId: string | null };

async function resolveChannel(admin: SupabaseClient, channel: { type: string; id: string }): Promise<ChannelContext | null> {
  if (channel.type === GROUP_CHANNEL_TYPE) {
    const { data } = await admin
      .from("group_chat_bindings")
      .select("group_id, church_id")
      .eq("channel_id", channel.id)
      .maybeSingle();
    return data ? { churchId: data.church_id as string, groupId: data.group_id as string, dmRowId: null } : null;
  }
  if (channel.type === DM_CHANNEL_TYPE) {
    const { data } = await admin
      .from("messaging_dm_channels")
      .select("id, church_id")
      .eq("channel_id", channel.id)
      .maybeSingle();
    return data ? { churchId: data.church_id as string, groupId: null, dmRowId: data.id as string } : null;
  }
  return null;
}

async function enqueue(admin: SupabaseClient, churchId: string | null, kind: string, subject: string) {
  await admin.rpc("enqueue_messaging_sync", {
    p_church_id: churchId,
    p_kind: kind,
    p_subject: subject,
    p_payload: {},
    p_delay_seconds: 0,
  });
}

/** Someone other than FaithForm changed something only FaithForm may change. */
function isClientActor(event: StreamEvent): boolean {
  const actor = event.user?.id;
  return Boolean(actor && actor !== SYSTEM_CHAT_USER_ID);
}

async function recordAutomaticReport(
  admin: SupabaseClient,
  event: StreamEvent,
  channel: ChannelContext,
  cid: string,
): Promise<void> {
  const message = event.message;
  const reportType = message?.id ? "message" : "user";
  const reportedChatId = message?.user?.id ?? event.target_user?.id;
  const reporterChatId = event.user?.id && event.user.id !== reportedChatId ? event.user.id : undefined;

  const [reporter, reported] = await Promise.all([
    authUserFor(admin, reporterChatId),
    authUserFor(admin, reportedChatId),
  ]);

  // A flag a member raised through FaithForm already has its report, with
  // their reason; this path exists for flags that did not come through us.
  if (reporter && message?.id) {
    const { data: existing } = await admin
      .from("messaging_reports")
      .select("id")
      .eq("reporter_user_id", reporter)
      .eq("message_id", message.id)
      .maybeSingle();
    if (existing) return;
  }
  if (!reporter && message?.id) {
    const { data: existing } = await admin
      .from("messaging_reports")
      .select("id")
      .is("reporter_user_id", null)
      .eq("message_id", message.id)
      .eq("status", "open")
      .maybeSingle();
    if (existing) return;
  }

  await admin.from("messaging_reports").insert({
    church_id: channel.churchId,
    report_type: reportType,
    reporter_user_id: reporter,
    reported_user_id: reported,
    reported_chat_user_id: reportedChatId && isChatUserId(reportedChatId) ? reportedChatId : null,
    reported_label: (message?.user?.name ?? event.target_user?.name ?? null)?.slice(0, 120) ?? null,
    group_id: channel.groupId,
    dm_channel_id: channel.dmRowId,
    channel_cid: cid,
    message_id: message?.id ?? null,
    message_excerpt: typeof message?.text === "string" ? message.text.slice(0, 500) : null,
    message_has_attachments: Array.isArray(message?.attachments) && message!.attachments!.length > 0,
    message_created_at: message?.created_at ?? null,
    reason: "inappropriate",
    details: reporter ? null : "Flagged automatically by the message filter.",
    source: reporter ? "member" : "automatic",
  });
}

async function dispatch(admin: SupabaseClient, event: StreamEvent): Promise<string> {
  const type = event.type ?? "";
  const channel = channelOf(event);
  if (!channel) return "ignored";
  const cid = `${channel.type}:${channel.id}`;

  if (type === "message.new") {
    if (channel.type !== GROUP_CHANNEL_TYPE) return "ignored";
    const createdAt = event.message?.created_at ?? event.created_at ?? new Date().toISOString();
    await admin.rpc("record_group_message_activity", { p_channel_id: channel.id, p_created_at: createdAt });
    // Stream delivers chat pushes directly using the mirrored device tokens
    // and per-group preferences. Do not enqueue a second broadcast here.
    return "counted";
  }

  const context = await resolveChannel(admin, channel);
  if (!context) return "unknown_channel";

  switch (type) {
    case "message.flagged":
    case "user.flagged": {
      await recordAutomaticReport(admin, event, context, cid);
      return "reported";
    }
    case "message.deleted": {
      // A leader removing someone else's message is a moderation decision and
      // is audited. A person deleting their own message is not.
      const deleter = event.user?.id;
      const author = event.message?.user?.id;
      if (deleter && author && deleter !== author && isChatUserId(deleter)) {
        const actorUser = await authUserFor(admin, deleter);
        await admin.from("messaging_moderation_actions").insert({
          church_id: context.churchId,
          group_id: context.groupId,
          target_user_id: await authUserFor(admin, author),
          target_label: (event.message?.user?.name ?? null)?.slice(0, 120) ?? null,
          message_id: event.message?.id ?? null,
          action: "message_removed",
          actor_type: "leader",
          actor_user_id: actorUser,
          detail: { via: "chat" },
        });
        return "audited";
      }
      return "ignored";
    }
    case "member.added":
    case "member.removed":
    case "member.updated":
    case "channel.updated":
    case "channel.truncated": {
      // Only FaithForm changes membership and channel settings; clients hold
      // no permission to. If a client-attributed change arrives anyway, the
      // reconcile puts things back as FaithForm has them.
      if (!isClientActor(event)) return "ignored";
      if (context.groupId) await enqueue(admin, context.churchId, "group.channel", context.groupId);
      if (context.dmRowId) await enqueue(admin, context.churchId, "dm.sync", `dm:${context.dmRowId}`);
      return "reconcile_requested";
    }
    case "channel.deleted": {
      if (context.groupId) await enqueue(admin, context.churchId, "group.channel", context.groupId);
      if (context.dmRowId) await enqueue(admin, context.churchId, "dm.sync", `dm:${context.dmRowId}`);
      return "reconcile_requested";
    }
    default:
      return "ignored";
  }
}

export async function handleChatWebhook(input: {
  rawBody: Buffer;
  headers: Headers;
  provider?: ChatProvider | null;
  client?: SupabaseClient;
}): Promise<WebhookResult> {
  const provider = input.provider === undefined ? getChatProvider() : input.provider;
  if (!provider) {
    // Not configured here: the provider retries, and nothing is processed
    // without the secret that proves the request is genuine.
    return { status: 503, body: { received: false, error: "not_configured" } };
  }

  if (input.rawBody.length > MAX_WEBHOOK_BYTES) {
    return { status: 413, body: { received: false, error: "too_large" } };
  }

  const apiKey = input.headers.get("x-api-key") ?? "";
  if (!constantTimeEqual(apiKey, provider.appKey)) {
    return { status: 401, body: { received: false, error: "unauthorized" } };
  }

  let text: string;
  try {
    text = decode(input.rawBody);
  } catch {
    return { status: 400, body: { received: false, error: "malformed" } };
  }

  const signature = input.headers.get("x-signature") ?? "";
  if (!provider.verifyWebhook(text, signature)) {
    return { status: 401, body: { received: false, error: "unauthorized" } };
  }

  let event: StreamEvent;
  try {
    event = JSON.parse(text) as StreamEvent;
  } catch {
    return { status: 400, body: { received: false, error: "malformed" } };
  }
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    return { status: 400, body: { received: false, error: "malformed" } };
  }

  const admin = input.client ?? createAdminClient();
  const headerId = input.headers.get("x-webhook-id")?.trim();
  const webhookId =
    headerId && headerId.length <= 128
      ? headerId
      : `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

  const claim = await admin
    .from("messaging_webhook_receipts")
    .insert({ webhook_id: webhookId, event_type: event.type.slice(0, 80) });
  if (claim.error) {
    if (claim.error.code === "23505") {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    // Could not record it: ask for a retry rather than process it unrecorded.
    return { status: 503, body: { received: false, error: "unavailable" } };
  }

  let outcome: string;
  try {
    outcome = await dispatch(admin, event);
  } catch {
    // Release the claim so the provider's retry is processed, not skipped.
    await admin.from("messaging_webhook_receipts").delete().eq("webhook_id", webhookId);
    return { status: 503, body: { received: false, error: "unavailable" } };
  }

  await admin
    .from("messaging_webhook_receipts")
    .update({ processed_at: new Date().toISOString(), outcome })
    .eq("webhook_id", webhookId);

  return { status: 200, body: { received: true } };
}

/** Receipts older than a month are only noise; the cron purges them. */
export async function purgeWebhookReceipts(admin: SupabaseClient, olderThanDays = 30): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  await admin.from("messaging_webhook_receipts").delete().lt("received_at", cutoff);
}
