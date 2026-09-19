import { VisitorError } from "@/lib/faithform/errors";
import { isUuid } from "@/lib/groups/context";
import { removeFromGroup } from "@/lib/groups/membership";
import { loadStaffGroup, type StaffContext } from "@/lib/groups/staff/context";
import { GROUP_CHANNEL_TYPE, parseCid, chatUserIdFor } from "@/lib/messaging/ids";
import { ChatProviderError, type ChatMessage } from "@/lib/messaging/provider";
import { getChatProvider } from "@/lib/messaging/stream-provider";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";

/**
 * Moderation from the dashboard.
 *
 * Reports arrive from members (and from the profanity filter as automatic
 * reports). Staff of the church resolve them here: remove the message,
 * suspend someone's messaging in this church, remove or ban them from the
 * group, or dismiss. Every decision is written to
 * `messaging_moderation_actions`, which is append-only.
 *
 * Privacy line: in a group conversation, a moderator sees the reported
 * message with a few messages either side. In a direct conversation they see
 * only what the reporter chose to report — the excerpt captured with the
 * report — and never the rest of the conversation.
 */

export const SUSPENSION_DURATIONS = ["24h", "7d", "30d", "indefinite"] as const;
export type SuspensionDuration = (typeof SUSPENSION_DURATIONS)[number];

const REPORT_COLUMNS =
  "id, report_type, reporter_user_id, reporter_label, reported_user_id, reported_chat_user_id, reported_label, group_id, dm_channel_id, channel_cid, message_id, message_excerpt, message_has_attachments, message_created_at, reason, details, source, status, resolution, resolved_by, resolved_at, resolution_note, created_at";

type ReportRow = {
  id: string;
  report_type: "message" | "user";
  reporter_user_id: string | null;
  reporter_label: string | null;
  reported_user_id: string | null;
  reported_chat_user_id: string | null;
  reported_label: string | null;
  group_id: string | null;
  dm_channel_id: string | null;
  channel_cid: string | null;
  message_id: string | null;
  message_excerpt: string | null;
  message_has_attachments: boolean;
  message_created_at: string | null;
  reason: string;
  details: string | null;
  source: "member" | "automatic";
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export type ReportListItem = {
  id: string;
  type: "message" | "user";
  reason: string;
  source: "member" | "automatic";
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  excerpt: string | null;
  hasAttachments: boolean;
  reportedName: string;
  reporterName: string | null;
  where: { kind: "group"; groupId: string; groupName: string } | { kind: "direct" } | { kind: "unknown" };
  createdAt: string;
  resolvedAt: string | null;
};

async function names(ctx: StaffContext, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const { data } = await ctx.admin.rpc("chat_display_names", { p_user_ids: ids });
  return new Map(((data ?? []) as { user_id: string; name: string | null }[]).map((row) => [row.user_id, row.name ?? "Church member"]));
}

async function groupNames(ctx: StaffContext, groupIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(groupIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const { data } = await ctx.admin.from("groups").select("id, name").eq("church_id", ctx.churchId).in("id", ids);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name]));
}

function toListItem(row: ReportRow, people: Map<string, string>, groups: Map<string, string>): ReportListItem {
  return {
    id: row.id,
    type: row.report_type,
    reason: row.reason,
    source: row.source,
    status: row.status,
    resolution: row.resolution,
    excerpt: row.message_excerpt,
    hasAttachments: row.message_has_attachments,
    reportedName: (row.reported_user_id && people.get(row.reported_user_id)) || row.reported_label || "Church member",
    reporterName:
      row.source === "automatic"
        ? null
        : (row.reporter_user_id && people.get(row.reporter_user_id)) || row.reporter_label || "Church member",
    where: row.group_id
      ? { kind: "group", groupId: row.group_id, groupName: groups.get(row.group_id) ?? "A group" }
      : row.dm_channel_id
        ? { kind: "direct" }
        : { kind: "unknown" },
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

export async function listReports(
  ctx: StaffContext,
  filters: { status?: "open" | "closed" | "all"; groupId?: string | null } = {},
): Promise<ReportListItem[]> {
  let query = ctx.admin
    .from("messaging_reports")
    .select(REPORT_COLUMNS)
    .eq("church_id", ctx.churchId)
    .order("created_at", { ascending: false })
    .limit(200);
  const status = filters.status ?? "open";
  if (status === "open") query = query.eq("status", "open");
  if (status === "closed") query = query.neq("status", "open");
  if (filters.groupId) {
    const group = await loadStaffGroup(ctx, filters.groupId, { includeDeleted: true });
    query = query.eq("group_id", group.id);
  }
  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load reports.");
  const rows = (data ?? []) as ReportRow[];
  const [people, groups] = await Promise.all([
    names(ctx, rows.flatMap((r) => [r.reporter_user_id, r.reported_user_id])),
    groupNames(ctx, rows.map((r) => r.group_id)),
  ]);
  return rows.map((row) => toListItem(row, people, groups));
}

export async function openReportCount(ctx: StaffContext): Promise<number> {
  const { count } = await ctx.admin
    .from("messaging_reports")
    .select("id", { count: "exact", head: true })
    .eq("church_id", ctx.churchId)
    .eq("status", "open");
  return count ?? 0;
}

async function loadReport(ctx: StaffContext, reportId: string): Promise<ReportRow> {
  if (!isUuid(reportId)) throw new VisitorError("group_not_found", "That report was not found.");
  const { data } = await ctx.admin
    .from("messaging_reports")
    .select(REPORT_COLUMNS)
    .eq("id", reportId)
    .eq("church_id", ctx.churchId)
    .maybeSingle();
  if (!data) throw new VisitorError("group_not_found", "That report was not found.");
  return data as ReportRow;
}

export type ReportDetail = ReportListItem & {
  details: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  message: {
    stillPresent: boolean;
    removed: boolean;
    createdAt: string | null;
  } | null;
  /** Group conversations only, oldest first; `isReported` marks the one. */
  context: { id: string; authorName: string; text: string; createdAt: string; isReported: boolean; removed: boolean; attachments: number }[] | null;
  contextUnavailable: boolean;
  reportedPerson: {
    authUserId: string | null;
    chatUserId: string | null;
    otherReports: number;
    suspension: { id: string; endsAt: string | null } | null;
    groupMembershipId: string | null;
  };
  actions: { id: string; action: string; actorName: string | null; actorType: string; reason: string | null; at: string }[];
};

export async function getReportDetail(ctx: StaffContext, reportId: string): Promise<ReportDetail> {
  const row = await loadReport(ctx, reportId);
  const [people, groups] = await Promise.all([
    names(ctx, [row.reporter_user_id, row.reported_user_id, row.resolved_by]),
    groupNames(ctx, [row.group_id]),
  ]);
  const base = toListItem(row, people, groups);

  let message: ReportDetail["message"] = null;
  let context: ReportDetail["context"] = null;
  let contextUnavailable = false;
  const provider = getChatProvider();
  if (row.message_id && provider) {
    try {
      const live = await provider.getMessage(row.message_id);
      message = {
        stillPresent: Boolean(live && !live.deleted && live.cid === row.channel_cid),
        removed: Boolean(live?.deleted),
        createdAt: row.message_created_at,
      };
      const parsed = parseCid(row.channel_cid);
      if (parsed?.type === GROUP_CHANNEL_TYPE && row.group_id) {
        const around: ChatMessage[] = await provider.getMessagesAround(parsed.type, parsed.id, row.message_id, 11);
        const authors = await authorNames(ctx, around);
        context = around.map((m) => ({
          id: m.id,
          authorName: (m.authorChatUserId && authors.get(m.authorChatUserId)) || m.authorName || "Church member",
          text: m.deleted ? "" : m.text.slice(0, 2000),
          createdAt: m.createdAt,
          isReported: m.id === row.message_id,
          removed: m.deleted,
          attachments: m.attachmentCount,
        }));
      }
    } catch (error) {
      if (!(error instanceof ChatProviderError)) throw error;
      contextUnavailable = true;
    }
  } else if (row.message_id) {
    contextUnavailable = true;
  }

  const [otherReports, suspension, membership, actions] = await Promise.all([
    row.reported_user_id
      ? ctx.admin
          .from("messaging_reports")
          .select("id", { count: "exact", head: true })
          .eq("church_id", ctx.churchId)
          .eq("reported_user_id", row.reported_user_id)
          .neq("id", row.id)
      : Promise.resolve({ count: 0 }),
    row.reported_user_id ? activeSuspension(ctx, row.reported_user_id) : Promise.resolve(null),
    row.reported_user_id && row.group_id ? membershipFor(ctx, row.group_id, row.reported_user_id) : Promise.resolve(null),
    ctx.admin
      .from("messaging_moderation_actions")
      .select("id, action, actor_type, actor_user_id, reason, created_at")
      .eq("church_id", ctx.churchId)
      .eq("report_id", row.id)
      .order("created_at", { ascending: true }),
  ]);
  const actionRows = (actions.data ?? []) as { id: string; action: string; actor_type: string; actor_user_id: string | null; reason: string | null; created_at: string }[];
  const actorNames = await names(ctx, actionRows.map((a) => a.actor_user_id));

  return {
    ...base,
    details: row.details,
    resolutionNote: row.resolution_note,
    resolvedByName: row.resolved_by ? people.get(row.resolved_by) ?? "A staff member" : null,
    message,
    context,
    contextUnavailable,
    reportedPerson: {
      authUserId: row.reported_user_id,
      chatUserId: row.reported_chat_user_id,
      otherReports: otherReports.count ?? 0,
      suspension,
      groupMembershipId: membership,
    },
    actions: actionRows.map((a) => ({
      id: a.id,
      action: a.action,
      actorName: a.actor_user_id ? actorNames.get(a.actor_user_id) ?? null : null,
      actorType: a.actor_type,
      reason: a.reason,
      at: new Date(a.created_at).toISOString(),
    })),
  };
}

async function authorNames(ctx: StaffContext, messages: ChatMessage[]): Promise<Map<string, string>> {
  const chatIds = [...new Set(messages.map((m) => m.authorChatUserId).filter((id): id is string => Boolean(id)))];
  if (chatIds.length === 0) return new Map();
  const { data } = await ctx.admin.from("messaging_user_bindings").select("user_id, chat_user_id").in("chat_user_id", chatIds);
  const bindings = (data ?? []) as { user_id: string; chat_user_id: string }[];
  const byUser = await names(ctx, bindings.map((b) => b.user_id));
  return new Map(bindings.map((b) => [b.chat_user_id, byUser.get(b.user_id) ?? "Church member"]));
}

async function activeSuspension(ctx: StaffContext, userId: string): Promise<{ id: string; endsAt: string | null } | null> {
  const { data } = await ctx.admin
    .from("messaging_restrictions")
    .select("id, ends_at")
    .eq("church_id", ctx.churchId)
    .eq("user_id", userId)
    .is("lifted_at", null)
    .maybeSingle();
  if (!data) return null;
  const endsAt = (data.ends_at as string | null) ?? null;
  if (endsAt && Date.parse(endsAt) <= Date.now()) return null;
  return { id: data.id as string, endsAt: endsAt ? new Date(endsAt).toISOString() : null };
}

async function membershipFor(ctx: StaffContext, groupId: string, userId: string): Promise<string | null> {
  const { data: account } = await ctx.admin.from("visitor_accounts").select("id").eq("user_id", userId).maybeSingle();
  if (!account) return null;
  const { data } = await ctx.admin
    .from("group_memberships")
    .select("id")
    .eq("group_id", groupId)
    .eq("church_id", ctx.churchId)
    .eq("account_id", account.id as string)
    .eq("status", "active")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function recordAction(
  ctx: StaffContext,
  input: {
    reportId: string | null;
    groupId: string | null;
    targetUserId: string | null;
    targetLabel: string | null;
    messageId: string | null;
    action: string;
    reason: string | null;
    detail?: Record<string, unknown>;
  },
) {
  await ctx.admin.from("messaging_moderation_actions").insert({
    church_id: ctx.churchId,
    report_id: input.reportId,
    group_id: input.groupId,
    target_user_id: input.targetUserId,
    target_label: input.targetLabel?.slice(0, 120) ?? null,
    message_id: input.messageId,
    action: input.action,
    actor_type: "staff",
    actor_user_id: ctx.userId,
    reason: input.reason?.slice(0, 1000) ?? null,
    detail: input.detail ?? {},
  });
}

type Resolution = "message_removed" | "member_suspended" | "member_removed" | "member_banned" | "no_action";

async function closeReport(ctx: StaffContext, row: ReportRow, resolution: Resolution, note: string | null) {
  const now = new Date().toISOString();
  const status = resolution === "no_action" ? "dismissed" : "resolved";
  await ctx.admin
    .from("messaging_reports")
    .update({
      status,
      resolution,
      resolved_by: ctx.userId,
      resolved_at: now,
      resolution_note: note?.trim().slice(0, 1000) || null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("church_id", ctx.churchId)
    .eq("status", "open");
  // Other open reports of the same message are the same decision.
  if (row.message_id && resolution === "message_removed") {
    await ctx.admin
      .from("messaging_reports")
      .update({ status, resolution, resolved_by: ctx.userId, resolved_at: now, updated_at: now })
      .eq("church_id", ctx.churchId)
      .eq("message_id", row.message_id)
      .eq("status", "open");
  }
}

/** Removes the reported message for everyone. The conversation keeps a "message removed" marker. */
export async function removeReportedMessage(ctx: StaffContext, reportId: string, note: string | null): Promise<void> {
  const row = await loadReport(ctx, reportId);
  if (!row.message_id) throw new VisitorError("invalid_input", "This report isn't about a message.");
  const provider = getChatProvider();
  if (!provider) throw new VisitorError("unavailable", "Messages aren't available right now.");
  const live = await provider.getMessage(row.message_id).catch((error) => {
    if (error instanceof ChatProviderError) throw new VisitorError("unavailable", "Messages are reconnecting. Try again in a moment.");
    throw error;
  });
  // Only a message in the conversation the report was about, in this church.
  if (live && live.cid !== row.channel_cid) throw new VisitorError("group_not_found", "That message was not found.");
  if (live && !live.deleted) {
    try {
      await provider.deleteMessage(row.message_id, { hard: false });
    } catch (error) {
      if (error instanceof ChatProviderError) throw new VisitorError("unavailable", "Could not remove the message. Try again.");
      throw error;
    }
  }
  await recordAction(ctx, {
    reportId: row.id,
    groupId: row.group_id,
    targetUserId: row.reported_user_id,
    targetLabel: row.reported_label,
    messageId: row.message_id,
    action: "message_removed",
    reason: note,
  });
  await closeReport(ctx, row, "message_removed", note);
}

export async function dismissReport(ctx: StaffContext, reportId: string, note: string | null): Promise<void> {
  const row = await loadReport(ctx, reportId);
  if (row.status !== "open") return;
  await recordAction(ctx, {
    reportId: row.id,
    groupId: row.group_id,
    targetUserId: row.reported_user_id,
    targetLabel: row.reported_label,
    messageId: row.message_id,
    action: "report_dismissed",
    reason: note,
  });
  await closeReport(ctx, row, "no_action", note);
}

function suspensionEnd(duration: SuspensionDuration): string | null {
  const hours = duration === "24h" ? 24 : duration === "7d" ? 24 * 7 : duration === "30d" ? 24 * 30 : null;
  return hours === null ? null : new Date(Date.now() + hours * 3_600_000).toISOString();
}

/**
 * Suspends someone's messaging in this church: they can read, but not post,
 * in every conversation of this church, and cannot start new ones. Applied to
 * the provider by the reconciler (a timed ban per channel); lifted on time by
 * a delayed reconcile, or early by `liftSuspension`.
 */
export async function suspendMessaging(
  ctx: StaffContext,
  input: { userId: string; duration: SuspensionDuration; reason: string | null; reportId?: string | null },
): Promise<void> {
  if (!isUuid(input.userId)) throw new VisitorError("group_not_found", "That person was not found.");
  if (!(SUSPENSION_DURATIONS as readonly string[]).includes(input.duration)) {
    throw new VisitorError("invalid_input", "Choose how long.");
  }
  if (input.userId === ctx.userId) throw new VisitorError("invalid_input", "You can't suspend yourself.");
  // Only someone with a standing in this church, and never its staff.
  const [{ data: account }, { data: staff }] = await Promise.all([
    ctx.admin.from("visitor_accounts").select("id").eq("user_id", input.userId).maybeSingle(),
    ctx.admin.from("church_users").select("user_id").eq("church_id", ctx.churchId).eq("user_id", input.userId).maybeSingle(),
  ]);
  if (staff) throw new VisitorError("forbidden", "Church staff can't be suspended from messaging.");
  if (!account) throw new VisitorError("group_not_found", "That person was not found.");
  const { data: relationship } = await ctx.admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", account.id as string)
    .eq("church_id", ctx.churchId)
    .maybeSingle();
  if (!relationship) throw new VisitorError("group_not_found", "That person was not found.");

  const report = input.reportId ? await loadReport(ctx, input.reportId) : null;
  const endsAt = suspensionEnd(input.duration);
  const reason = input.reason?.trim().slice(0, 500) || null;

  const existing = await activeSuspension(ctx, input.userId);
  if (existing) {
    await ctx.admin
      .from("messaging_restrictions")
      .update({ ends_at: endsAt, reason })
      .eq("id", existing.id)
      .eq("church_id", ctx.churchId);
  } else {
    // A lapsed-but-unlifted row would collide with the one-open index: close it.
    await ctx.admin
      .from("messaging_restrictions")
      .update({ lifted_at: new Date().toISOString(), lifted_by: ctx.userId })
      .eq("church_id", ctx.churchId)
      .eq("user_id", input.userId)
      .is("lifted_at", null);
    const { error } = await ctx.admin.from("messaging_restrictions").insert({
      church_id: ctx.churchId,
      user_id: input.userId,
      reason,
      ends_at: endsAt,
      created_by: ctx.userId,
    });
    if (error) throw new VisitorError("unavailable", "Could not suspend messaging. Try again.");
  }

  const label = (await names(ctx, [input.userId])).get(input.userId) ?? null;
  await recordAction(ctx, {
    reportId: report?.id ?? null,
    groupId: report?.group_id ?? null,
    targetUserId: input.userId,
    targetLabel: label,
    messageId: report?.message_id ?? null,
    action: "user_suspended",
    reason,
    detail: { duration: input.duration, endsAt },
  });
  if (report) await closeReport(ctx, report, "member_suspended", reason);
  await syncNow([dedupeKey("church.restriction", `${ctx.churchId}:${input.userId}`)], { budgetMs: 5_000 });
}

export async function liftSuspension(ctx: StaffContext, restrictionId: string): Promise<void> {
  if (!isUuid(restrictionId)) throw new VisitorError("group_not_found", "That suspension was not found.");
  const { data } = await ctx.admin
    .from("messaging_restrictions")
    .update({ lifted_at: new Date().toISOString(), lifted_by: ctx.userId })
    .eq("id", restrictionId)
    .eq("church_id", ctx.churchId)
    .is("lifted_at", null)
    .select("user_id");
  const row = (data ?? [])[0] as { user_id: string } | undefined;
  if (!row) throw new VisitorError("group_not_found", "That suspension was not found.");
  const label = (await names(ctx, [row.user_id])).get(row.user_id) ?? null;
  await recordAction(ctx, {
    reportId: null,
    groupId: null,
    targetUserId: row.user_id,
    targetLabel: label,
    messageId: null,
    action: "suspension_lifted",
    reason: null,
  });
  await syncNow([dedupeKey("church.restriction", `${ctx.churchId}:${row.user_id}`)], { budgetMs: 5_000 });
}

export async function listSuspensions(ctx: StaffContext) {
  const { data } = await ctx.admin
    .from("messaging_restrictions")
    .select("id, user_id, reason, starts_at, ends_at, created_by")
    .eq("church_id", ctx.churchId)
    .is("lifted_at", null)
    .order("starts_at", { ascending: false })
    .limit(200);
  const rows = ((data ?? []) as { id: string; user_id: string; reason: string | null; starts_at: string; ends_at: string | null; created_by: string | null }[]).filter(
    (row) => !row.ends_at || Date.parse(row.ends_at) > Date.now(),
  );
  const people = await names(ctx, rows.flatMap((r) => [r.user_id, r.created_by]));
  return rows.map((row) => ({
    id: row.id,
    name: people.get(row.user_id) ?? "Church member",
    chatUserId: chatUserIdFor(row.user_id),
    reason: row.reason,
    since: new Date(row.starts_at).toISOString(),
    until: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    byName: row.created_by ? people.get(row.created_by) ?? "A staff member" : null,
  }));
}

/** Removes (optionally bans) the reported person from the group the report was in. */
export async function removeReportedFromGroup(
  ctx: StaffContext,
  reportId: string,
  input: { ban: boolean; note: string | null },
): Promise<void> {
  const row = await loadReport(ctx, reportId);
  if (!row.group_id || !row.reported_user_id) {
    throw new VisitorError("invalid_input", "This report isn't about someone in a group.");
  }
  const group = await loadStaffGroup(ctx, row.group_id);
  const membershipId = await membershipFor(ctx, group.id, row.reported_user_id);
  if (!membershipId) throw new VisitorError("conflict", "They are no longer in this group.");
  const note = input.note?.trim().slice(0, 500) || null;
  await removeFromGroup(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    membershipId,
    ban: input.ban,
    reason: note,
    actor: { type: "staff", userId: ctx.userId },
  });
  await recordAction(ctx, {
    reportId: row.id,
    groupId: group.id,
    targetUserId: row.reported_user_id,
    targetLabel: row.reported_label,
    messageId: row.message_id,
    action: input.ban ? "member_banned" : "member_removed",
    reason: note,
  });
  await closeReport(ctx, row, input.ban ? "member_banned" : "member_removed", note);
}

const ACTION_LABELS: Record<string, string> = {
  message_removed: "Removed a message",
  report_dismissed: "Dismissed a report",
  report_resolved: "Resolved a report",
  user_suspended: "Suspended messaging",
  suspension_lifted: "Lifted a suspension",
  member_removed: "Removed from a group",
  member_banned: "Removed and banned from a group",
  ban_lifted: "Lifted a ban",
  note: "Added a note",
};

export async function moderationLog(ctx: StaffContext, limit = 100) {
  const { data } = await ctx.admin
    .from("messaging_moderation_actions")
    .select("id, action, actor_type, actor_user_id, target_user_id, target_label, group_id, reason, report_id, created_at")
    .eq("church_id", ctx.churchId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));
  const rows = (data ?? []) as {
    id: string;
    action: string;
    actor_type: string;
    actor_user_id: string | null;
    target_user_id: string | null;
    target_label: string | null;
    group_id: string | null;
    reason: string | null;
    report_id: string | null;
    created_at: string;
  }[];
  const [people, groups] = await Promise.all([
    names(ctx, rows.flatMap((r) => [r.actor_user_id, r.target_user_id])),
    groupNames(ctx, rows.map((r) => r.group_id)),
  ]);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    label: ACTION_LABELS[row.action] ?? row.action.replace(/_/g, " "),
    actor:
      row.actor_type === "system"
        ? "Automatic"
        : (row.actor_user_id && people.get(row.actor_user_id)) || (row.actor_type === "leader" ? "A group leader" : "A staff member"),
    actorType: row.actor_type,
    target: (row.target_user_id && people.get(row.target_user_id)) || row.target_label || null,
    groupName: row.group_id ? groups.get(row.group_id) ?? null : null,
    reason: row.reason,
    reportId: row.report_id,
    at: new Date(row.created_at).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Sync health — what an administrator needs when chat and FaithForm disagree.
// ---------------------------------------------------------------------------

export async function syncHealth(ctx: StaffContext) {
  const [{ count: failed }, { count: pending }, { data: recent }] = await Promise.all([
    ctx.admin
      .from("messaging_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("church_id", ctx.churchId)
      .eq("status", "failed"),
    ctx.admin
      .from("messaging_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("church_id", ctx.churchId)
      .in("status", ["pending", "running"])
      .lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString()),
    ctx.admin
      .from("messaging_sync_jobs")
      .select("kind, last_error, updated_at")
      .eq("church_id", ctx.churchId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);
  return {
    failed: failed ?? 0,
    delayed: pending ?? 0,
    recentFailures: ((recent ?? []) as { kind: string; last_error: string | null; updated_at: string }[]).map((r) => ({
      kind: r.kind,
      error: r.last_error,
      at: new Date(r.updated_at).toISOString(),
    })),
  };
}

/** Puts this church's failed reconciles back in the queue. Admins only. */
export async function retryFailedSync(ctx: StaffContext): Promise<number> {
  if (!ctx.isAdmin) throw new VisitorError("forbidden", "Only church admins can do this.");
  const { data: failed } = await ctx.admin
    .from("messaging_sync_jobs")
    .select("id, kind, subject, payload")
    .eq("church_id", ctx.churchId)
    .eq("status", "failed")
    .limit(500);
  let requeued = 0;
  for (const job of (failed ?? []) as { id: string; kind: string; subject: string; payload: Record<string, unknown> | null }[]) {
    // Re-enqueue as a fresh intent (coalescing with any pending one), and
    // close the dead letter so it is not counted twice.
    await ctx.admin.rpc("enqueue_messaging_sync", {
      p_church_id: ctx.churchId,
      p_kind: job.kind,
      p_subject: job.subject,
      p_payload: job.payload ?? {},
      p_delay_seconds: 0,
    });
    await ctx.admin
      .from("messaging_sync_jobs")
      .update({ status: "cancelled", last_error: "requeued", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "failed");
    requeued += 1;
  }
  return requeued;
}
