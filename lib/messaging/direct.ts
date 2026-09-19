import type { SupabaseClient } from "@supabase/supabase-js";

import { VisitorError } from "@/lib/faithform/errors";
import { resolveMemberContext, type MemberContext } from "@/lib/groups/context";
import { labelMemberships } from "@/lib/groups/read-models";
import { authUserForChatId, ensureBindings } from "@/lib/messaging/directory";
import { decideDirectMessage, dmRefusalMessage, type DmParty } from "@/lib/messaging/dm-policy";
import { isBlockedEitherWay, loadDmParties } from "@/lib/messaging/dm-parties";
import { DM_CHANNEL_TYPE, chatUserIdFor, cidOf, dmChannelId, isChatUserId, orderedPair } from "@/lib/messaging/ids";
import { getChurchMessagingSettings } from "@/lib/messaging/settings";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";
import { decodeCursor, encodeCursor } from "@/lib/mobile/v1/protocol";

/**
 * Direct conversations: authorized by FaithForm before one exists.
 *
 * A client names the other person by their chat id — the id they already see
 * in a conversation or a contact list — and nothing else. The server resolves
 * both people, their standing in this church, blocks either way, and the
 * church's policy (`dm-policy.ts`), and only then records the conversation and
 * has the reconciler create it. There is no client path that creates a
 * channel, and none that adds a third person.
 */

export async function startDirectConversation(userId: string, churchSlug: string, targetChatUserId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  if (!isChatUserId(targetChatUserId)) throw new VisitorError("forbidden", dmRefusalMessage("unavailable"));

  const targetUserId = await authUserForChatId(ctx.admin, targetChatUserId);
  if (!targetUserId) throw new VisitorError("forbidden", dmRefusalMessage("unavailable"));
  if (targetUserId === userId) throw new VisitorError("forbidden", dmRefusalMessage("self"));

  const [settings, parties, blocked] = await Promise.all([
    getChurchMessagingSettings(ctx.admin, ctx.church.id),
    loadDmParties(ctx.admin, ctx.church.id, [userId, targetUserId]),
    isBlockedEitherWay(ctx.admin, userId, targetUserId),
  ]);
  const decision = decideDirectMessage({
    policy: settings.dmPolicy,
    messagingEnabled: settings.messagingEnabled,
    initiator: parties.get(userId)!,
    target: parties.get(targetUserId)!,
    blocked,
    mode: "start",
  });
  if (!decision.allowed) throw new VisitorError("forbidden", dmRefusalMessage(decision.reason));

  const [low, high] = orderedPair(userId, targetUserId);
  const channelId = dmChannelId(ctx.church.id, low, high);
  await ctx.admin
    .from("messaging_dm_channels")
    .upsert(
      { church_id: ctx.church.id, channel_id: channelId, user_low: low, user_high: high, created_by: userId },
      { onConflict: "church_id,user_low,user_high", ignoreDuplicates: true },
    );
  const { data: row } = await ctx.admin
    .from("messaging_dm_channels")
    .select("id, state")
    .eq("church_id", ctx.church.id)
    .eq("user_low", low)
    .eq("user_high", high)
    .maybeSingle();
  if (!row) throw new VisitorError("unavailable", "Could not start that conversation right now.");

  await ensureBindings(ctx.admin, [low, high]);
  await ctx.admin.rpc("enqueue_messaging_sync", {
    p_church_id: ctx.church.id,
    p_kind: "dm.sync",
    p_subject: `dm:${row.id}`,
    p_payload: {},
    p_delay_seconds: 0,
  });
  await syncNow([dedupeKey("dm.sync", `dm:${row.id}`)]);

  const { data: after } = await ctx.admin.from("messaging_dm_channels").select("state").eq("id", row.id).maybeSingle();
  const state = (after?.state as string | undefined) ?? "pending";
  return {
    cid: cidOf(DM_CHANNEL_TYPE, channelId),
    channelId,
    // `pending`: recorded and authorized, still being set up with the chat
    // provider (the reconciler finishes it); the app shows "Starting…".
    state: state === "frozen" ? "read_only" : state === "active" ? "ready" : "pending",
  };
}

type Candidate = { userId: string; accountId: string; name: string; avatarUrl: string | null; context: string | null };

async function groupCandidates(ctx: MemberContext, admin: SupabaseClient): Promise<Map<string, Candidate>> {
  const { data: mine } = await admin
    .from("group_memberships")
    .select("group_id")
    .eq("church_id", ctx.church.id)
    .eq("account_id", ctx.account.id)
    .eq("status", "active");
  const groupIds = ((mine ?? []) as { group_id: string }[]).map((r) => r.group_id);
  const found = new Map<string, Candidate>();
  if (groupIds.length === 0) return found;

  const { data } = await admin
    .from("group_memberships")
    .select("id, member_id, account_id, group_role, groups!inner(name, status), visitor_accounts!inner(user_id, status)")
    .in("group_id", groupIds)
    .eq("status", "active")
    .not("account_id", "is", null)
    .limit(3000);
  type Row = {
    id: string;
    member_id: string | null;
    account_id: string;
    group_role: string;
    groups: { name: string; status: string } | { name: string; status: string }[];
    visitor_accounts: { user_id: string; status: string } | { user_id: string; status: string }[];
  };
  const rows = ((data ?? []) as Row[]).filter((row) => {
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    return group?.status === "active";
  });
  const labels = await labelMemberships(admin, rows);
  for (const row of rows) {
    const account = Array.isArray(row.visitor_accounts) ? row.visitor_accounts[0] : row.visitor_accounts;
    if (!account || account.status !== "active" || account.user_id === ctx.userId) continue;
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    const label = labels.get(row.id);
    const context = row.group_role === "member" ? group.name : `Leader · ${group.name}`;
    const existing = found.get(account.user_id);
    // A leader relationship is the more useful thing to say.
    if (!existing || (row.group_role !== "member" && !existing.context?.startsWith("Leader"))) {
      found.set(account.user_id, {
        userId: account.user_id,
        accountId: row.account_id,
        name: label?.name ?? "Church member",
        avatarUrl: label?.avatarUrl ?? null,
        context,
      });
    }
  }
  return found;
}

async function churchCandidates(ctx: MemberContext, admin: SupabaseClient): Promise<Map<string, Candidate>> {
  const { data } = await admin
    .from("visitor_church_relationships")
    .select("account_id, visitor_accounts!inner(user_id, display_name, avatar_url, status)")
    .eq("church_id", ctx.church.id)
    .in("state", ["following", "pending", "joined"])
    .limit(3000);
  type Row = {
    account_id: string;
    visitor_accounts: { user_id: string; display_name: string | null; avatar_url: string | null; status: string } | { user_id: string; display_name: string | null; avatar_url: string | null; status: string }[];
  };
  const found = new Map<string, Candidate>();
  for (const row of (data ?? []) as Row[]) {
    const account = Array.isArray(row.visitor_accounts) ? row.visitor_accounts[0] : row.visitor_accounts;
    if (!account || account.status !== "active" || account.user_id === ctx.userId) continue;
    const name = account.display_name?.trim();
    if (!name) continue; // Someone with no name cannot be picked out of a list.
    found.set(account.user_id, {
      userId: account.user_id,
      accountId: row.account_id,
      name: name.slice(0, 120),
      avatarUrl: account.avatar_url && /^https:\/\//.test(account.avatar_url) ? account.avatar_url : null,
      context: null,
    });
  }
  return found;
}

/**
 * People this person may start a conversation with, under their church's
 * policy — never a church-wide directory unless the church chose `everyone`,
 * and never anyone in a youth group, anyone blocked either way, or a staff
 * member's private list.
 */
export async function listMessageableContacts(
  userId: string,
  churchSlug: string,
  input: { query?: string | null; cursor?: string | null; limit?: number },
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const settings = await getChurchMessagingSettings(ctx.admin, ctx.church.id);
  const me = (await loadDmParties(ctx.admin, ctx.church.id, [userId])).get(userId);
  const empty = { items: [], nextCursor: null };
  if (!me || !settings.messagingEnabled || settings.dmPolicy === "disabled" || me.inYouthGroup || me.restricted || !me.eligible) {
    return empty;
  }

  const candidates =
    settings.dmPolicy === "everyone" || me.isStaff
      ? await churchCandidates(ctx, ctx.admin)
      : await groupCandidates(ctx, ctx.admin);
  if (candidates.size === 0) return empty;

  const ids = [...candidates.keys()];
  const [parties, { data: blocks }] = await Promise.all([
    loadDmParties(ctx.admin, ctx.church.id, ids),
    ctx.admin
      .from("messaging_blocks")
      .select("blocker_user_id, blocked_user_id")
      .or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`),
  ]);
  const blocked = new Set(
    ((blocks ?? []) as { blocker_user_id: string; blocked_user_id: string }[]).map((b) =>
      b.blocker_user_id === userId ? b.blocked_user_id : b.blocker_user_id,
    ),
  );

  const needle = input.query?.trim().toLowerCase() ?? "";
  const allowed = [...candidates.values()]
    .filter((candidate) => {
      if (needle && !candidate.name.toLowerCase().includes(needle)) return false;
      const party = parties.get(candidate.userId) as DmParty | undefined;
      if (!party) return false;
      return decideDirectMessage({
        policy: settings.dmPolicy,
        messagingEnabled: settings.messagingEnabled,
        initiator: me,
        target: party,
        blocked: blocked.has(candidate.userId),
        mode: "start",
      }).allowed;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const limit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const offset = Number(decodeCursor(input.cursor, "dm_contacts")?.[0] ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) throw new VisitorError("invalid_input", "Invalid cursor.");
  const page = allowed.slice(offset, offset + limit);
  // A contact must be addressable by chat id before anyone can message them.
  await ensureBindings(ctx.admin, page.map((candidate) => candidate.userId));

  return {
    items: page.map((candidate) => ({
      chatUserId: chatUserIdFor(candidate.userId),
      name: candidate.name,
      avatarUrl: candidate.avatarUrl,
      context: candidate.context,
    })),
    nextCursor: offset + limit < allowed.length ? encodeCursor("dm_contacts", [String(offset + limit)]) : null,
  };
}
