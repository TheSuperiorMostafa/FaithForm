import { VisitorError } from "@/lib/faithform/errors";
import { resolveMemberContext } from "@/lib/groups/context";
import { requireChannelAccess } from "@/lib/messaging/access";
import { authUserForChatId } from "@/lib/messaging/directory";
import { chatUserIdFor, isChatUserId } from "@/lib/messaging/ids";
import { ChatProviderError } from "@/lib/messaging/provider";
import { getChatProvider } from "@/lib/messaging/stream-provider";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";

/**
 * What a member can do about someone else: report a message, report a
 * person, block them. Every one of these is checked against FaithForm's own
 * records — the reporter must actually be in the conversation, the message
 * must actually be in it — so a report cannot be aimed at a conversation, or
 * a church, the reporter has no part in.
 */

export const REPORT_REASONS = [
  "spam", "harassment", "hate", "sexual", "violence", "self_harm", "inappropriate", "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export async function submitReport(
  userId: string,
  churchSlug: string,
  input: { cid: string; messageId?: string | null; reportedChatUserId?: string | null; reason: ReportReason; details?: string | null },
): Promise<{ received: true }> {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const channel = await requireChannelAccess(ctx, input.cid);

  let reportedUserId: string | null = null;
  let reportedChatUserId: string | null = null;
  let reportedLabel: string | null = null;
  let excerpt: string | null = null;
  let messageCreatedAt: string | null = null;
  let hasAttachments = false;
  const messageId = input.messageId?.trim() || null;

  if (messageId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) throw new VisitorError("invalid_input", "That message can't be reported.");
    const provider = getChatProvider();
    if (provider) {
      try {
        const message = await provider.getMessage(messageId);
        // The message must be in the conversation the reporter named — the
        // one we just confirmed they are part of.
        if (!message || message.cid !== channel.cid) {
          throw new VisitorError("group_not_found", "That message was not found.");
        }
        reportedChatUserId = message.authorChatUserId;
        reportedLabel = message.authorName;
        excerpt = message.text ? message.text.slice(0, 500) : null;
        messageCreatedAt = message.createdAt;
        hasAttachments = message.attachmentCount > 0;
      } catch (error) {
        if (error instanceof VisitorError) throw error;
        // The provider is unreachable: the report is still recorded, and staff
        // load the message when they open it.
        if (!(error instanceof ChatProviderError)) throw error;
      }
    }
  } else if (input.reportedChatUserId) {
    if (!isChatUserId(input.reportedChatUserId)) throw new VisitorError("invalid_input", "That person can't be reported.");
    reportedChatUserId = input.reportedChatUserId;
  } else {
    throw new VisitorError("invalid_input", "Choose a message or a person to report.");
  }

  if (reportedChatUserId) {
    reportedUserId = await authUserForChatId(ctx.admin, reportedChatUserId);
    if (reportedUserId === userId) throw new VisitorError("invalid_input", "You can't report yourself.");
  }

  const row = {
    church_id: ctx.church.id,
    report_type: messageId ? "message" : "user",
    reporter_user_id: userId,
    reporter_label: ctx.account.displayName?.slice(0, 120) ?? null,
    reported_user_id: reportedUserId,
    reported_chat_user_id: reportedChatUserId,
    reported_label: reportedLabel?.slice(0, 120) ?? null,
    group_id: channel.kind === "group" ? channel.groupId : null,
    dm_channel_id: channel.kind === "direct" ? channel.dmRowId : null,
    channel_cid: channel.cid,
    message_id: messageId,
    message_excerpt: excerpt,
    message_has_attachments: hasAttachments,
    message_created_at: messageCreatedAt,
    reason: input.reason,
    details: input.details?.trim().slice(0, 1000) || null,
    source: "member",
  };
  const { error } = await ctx.admin.from("messaging_reports").insert(row);
  // The same person reporting the same message twice is one report.
  if (error && error.code !== "23505") throw new VisitorError("unavailable", "Could not send that report. Try again.");

  if (messageId && !error) {
    const provider = getChatProvider();
    // Mirrors the report as the provider's own flag, so its moderation tools
    // agree. Best effort: the FaithForm report is the record.
    await provider?.flagMessage(messageId, chatUserIdFor(userId), input.reason).catch(() => undefined);
  }
  console.info("[messaging] report received", JSON.stringify({ kind: row.report_type, reason: input.reason }));
  return { received: true };
}

export async function blockPerson(userId: string, churchSlug: string, chatUserId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  if (!isChatUserId(chatUserId)) throw new VisitorError("invalid_input", "That person can't be blocked.");
  const target = await authUserForChatId(ctx.admin, chatUserId);
  if (!target) throw new VisitorError("group_not_found", "That person was not found.");
  if (target === userId) throw new VisitorError("invalid_input", "You can't block yourself.");
  const { error } = await ctx.admin
    .from("messaging_blocks")
    .upsert(
      { blocker_user_id: userId, blocked_user_id: target, church_id: ctx.church.id },
      { onConflict: "blocker_user_id,blocked_user_id", ignoreDuplicates: true },
    );
  if (error) throw new VisitorError("unavailable", "Could not block them right now.");
  await syncNow([dedupeKey("user.blocks", userId), dedupeKey("dm.sync", `user:${userId}`)]);
  return listBlocked(userId, churchSlug);
}

export async function unblockPerson(userId: string, churchSlug: string, chatUserId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  if (!isChatUserId(chatUserId)) throw new VisitorError("invalid_input", "That person can't be unblocked.");
  const target = await authUserForChatId(ctx.admin, chatUserId);
  if (target) {
    await ctx.admin.from("messaging_blocks").delete().eq("blocker_user_id", userId).eq("blocked_user_id", target);
    await syncNow([dedupeKey("user.blocks", userId), dedupeKey("dm.sync", `user:${userId}`)]);
  }
  return listBlocked(userId, churchSlug);
}

export async function listBlocked(userId: string, churchSlug: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const { data } = await ctx.admin
    .from("messaging_blocks")
    .select("blocked_user_id, created_at")
    .eq("blocker_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as { blocked_user_id: string; created_at: string }[];
  const { data: names } = rows.length
    ? await ctx.admin.rpc("chat_display_names", { p_user_ids: rows.map((row) => row.blocked_user_id) })
    : { data: [] };
  const nameByUser = new Map(((names ?? []) as { user_id: string; name: string | null }[]).map((n) => [n.user_id, n.name]));
  return {
    items: rows.map((row) => ({
      chatUserId: chatUserIdFor(row.blocked_user_id),
      name: nameByUser.get(row.blocked_user_id) ?? "Church member",
      blockedAt: new Date(row.created_at).toISOString(),
    })),
  };
}
