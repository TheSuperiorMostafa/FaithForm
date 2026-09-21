import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dmChannelData,
  dmChannelOverrides,
  groupChannelData,
  groupChannelFrozen,
  groupChannelOverrides,
  type GroupChannelSource,
} from "@/lib/messaging/channel-spec";
import { decideDirectMessage } from "@/lib/messaging/dm-policy";
import { isBlockedEitherWay, loadDmParties } from "@/lib/messaging/dm-parties";
import {
  churchesWithGroups,
  ensureBindings,
  provisionChatUsers,
  resolveChatIdentities,
} from "@/lib/messaging/directory";
import {
  DM_CHANNEL_TYPE,
  GROUP_CHANNEL_TYPE,
  chatUserIdFor,
  cidOf,
  groupChannelId,
  type ChannelType,
} from "@/lib/messaging/ids";
import type { ChannelRole, ChatProvider, PushLevel, PushPreferenceInput } from "@/lib/messaging/provider";
import { getChurchMessagingSettings } from "@/lib/messaging/settings";

/**
 * The reconcilers. Each one answers "what should the chat provider look like
 * for this subject, according to FaithForm right now?" and makes it so.
 *
 * Every handler is a diff, never a delta, which is the whole failure model:
 * a retry after a partial failure, a duplicate job, or a job that runs after
 * a later change all converge on the same result. None of them trusts what
 * the provider says about who *should* be anywhere — the provider is only
 * asked what *is* there, so the difference can be applied.
 */

export type SyncJob = {
  id: string;
  church_id: string | null;
  kind: string;
  subject: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

export type HandlerContext = {
  admin: SupabaseClient;
  provider: ChatProvider;
  now: Date;
  /** Queues a follow-up reconcile, optionally not before `delaySeconds`. */
  enqueue: (
    churchId: string | null,
    kind: string,
    subject: string,
    payload?: Record<string, unknown>,
    delaySeconds?: number,
  ) => Promise<void>;
};

export type HandlerResult = { detail?: Record<string, number> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAR_FUTURE = "2099-12-31T00:00:00.000Z";

function requireUuid(value: string): string {
  if (!UUID.test(value)) throw new Error("malformed subject");
  return value;
}

/** The deployment environment an installation must match to be mirrored. */
export function currentPushEnvironment(): string {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function syncUser(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const userId = requireUuid(job.subject);
  const { data: binding } = await ctx.admin
    .from("messaging_user_bindings")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  // Someone who has never used chat has nothing at the provider to correct.
  if (!binding) return {};

  const identity = (await resolveChatIdentities(ctx.admin, [userId])).get(userId);
  if (!identity) {
    // No app account and no staff access left: they keep their chat identity
    // (history stays attributed) but lose every tenant.
    const chatUserId = chatUserIdFor(userId);
    await ctx.provider.upsertUsers([
      { chatUserId, name: "Former member", image: null, teams: [], teamRoles: {}, isStaff: false },
    ]);
    await ctx.provider.revokeUserTokens(chatUserId, ctx.now);
    await ctx.admin
      .from("messaging_user_bindings")
      .update({ synced_teams: [], synced_profile_hash: null, synced_at: ctx.now.toISOString() })
      .eq("user_id", userId);
    return { detail: { revoked: 1 } };
  }

  const { lostTenant } = await provisionChatUsers(ctx.admin, ctx.provider, [identity]);
  for (const chatUserId of lostTenant) {
    // A tenant lost (left or blocked by a church, staff access removed):
    // every token issued before now stops working, so no open connection
    // keeps reading a church it no longer belongs to.
    await ctx.provider.revokeUserTokens(chatUserId, ctx.now);
  }
  return { detail: { revoked: lostTenant.length } };
}

async function deleteUser(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const chatUserId = String(job.payload.chatUserId ?? job.subject);
  if (!/^ff_[a-z2-7]{26}$/.test(chatUserId)) throw new Error("malformed subject");
  await ctx.provider.deleteUsers([chatUserId]);
  return {};
}

async function syncDevices(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const userId = requireUuid(job.subject);
  const chatUserId = chatUserIdFor(userId);
  const { data: account } = await ctx.admin
    .from("visitor_accounts")
    .select("id, status")
    .eq("user_id", userId)
    .maybeSingle();

  let desired: import("@/lib/messaging/provider").ChatDevice[] = [];
  if (account && account.status === "active") {
    const { data: installations } = await ctx.admin
      .from("visitor_device_installations")
      .select("provider, provider_token, apns_environment")
      .eq("account_id", account.id as string)
      .eq("environment", currentPushEnvironment())
      .eq("is_enabled", true)
      .is("invalidated_at", null)
      .limit(25);
    desired = ((installations ?? []) as { provider: string; provider_token: string; apns_environment?: "development" | "production" | null }[])
      .filter((row) => row.provider_token && row.provider_token.length >= 16)
      .map((row) => ({ token: row.provider_token, provider: row.provider === "apns" ? "apn" : "firebase", apnsEnvironment: row.apns_environment }));
  }

  const actual = await ctx.provider.listDevices(chatUserId);
  const desiredTokens = new Set(desired.map((device) => device.token));
  const actualByToken = new Map(actual.map((device) => [device.token, device]));

  let added = 0;
  let removed = 0;
  for (const device of desired) {
    const previous = actualByToken.get(device.token);
    const changedEnvironment = previous && device.provider === "apn" &&
      (previous.apnsEnvironment ?? "production") !== (device.apnsEnvironment ?? "production");
    if (changedEnvironment) await ctx.provider.removeDevice(chatUserId, device.token);
    if (!previous || changedEnvironment) {
      await ctx.provider.addDevice(chatUserId, device);
      added += 1;
    }
  }
  for (const device of actual) {
    if (!desiredTokens.has(device.token)) {
      await ctx.provider.removeDevice(chatUserId, device.token);
      removed += 1;
    }
  }
  return { detail: { added, removed } };
}

function pushLevelFor(level: string): PushLevel {
  if (level === "muted") return "none";
  if (level === "mentions") return "mentions";
  if (level === "all") return "all";
  return "default";
}

async function syncPush(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const userId = requireUuid(job.subject);
  const chatUserId = chatUserIdFor(userId);
  const { data: account } = await ctx.admin
    .from("visitor_accounts")
    .select("id, selected_church_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!account) return {};

  const [{ data: memberships }, { data: globals }] = await Promise.all([
    ctx.admin
      .from("group_memberships")
      .select("group_id, church_id, notification_level")
      .eq("account_id", account.id as string)
      .eq("status", "active"),
    ctx.admin
      .from("messaging_notification_preferences")
      .select("church_id, level")
      .eq("account_id", account.id as string),
  ]);

  const levelByChurch = new Map(
    ((globals ?? []) as { church_id: string; level: string }[]).map((row) => [row.church_id, row.level]),
  );
  // One church per account (0090): its level is the account's chat level.
  const churchId =
    (account.selected_church_id as string | null) ??
    ((memberships ?? []) as { church_id: string }[])[0]?.church_id ??
    null;
  const global = churchId ? levelByChurch.get(churchId) ?? "all" : "all";

  const preferences: PushPreferenceInput[] = [
    global === "off"
      ? { chatUserId, disabledUntil: FAR_FUTURE }
      : { chatUserId, level: global === "mentions" ? "mentions" : "all", removeDisable: true },
  ];

  const rows = (memberships ?? []) as { group_id: string; notification_level: string }[];
  let muted = 0;
  for (const row of rows) {
    const channelId = groupChannelId(row.group_id);
    preferences.push({
      chatUserId,
      channelCid: cidOf(GROUP_CHANNEL_TYPE, channelId),
      level: pushLevelFor(row.notification_level),
    });
  }
  await ctx.provider.setPushPreferences(preferences);

  // Muting is also a read-state matter: a muted group should not light the
  // badge. The provider's channel mute does exactly that.
  for (const row of rows) {
    const channelId = groupChannelId(row.group_id);
    try {
      if (row.notification_level === "muted") {
        await ctx.provider.muteChannel(GROUP_CHANNEL_TYPE, channelId, chatUserId);
        muted += 1;
      } else {
        await ctx.provider.unmuteChannel(GROUP_CHANNEL_TYPE, channelId, chatUserId);
      }
    } catch (error) {
      // A channel not provisioned yet will be muted by the next run, which
      // group.members queues when it adds this person.
      if ((error as { category?: string }).category !== "not_found") throw error;
    }
  }
  return { detail: { channels: rows.length, muted } };
}

async function syncBlocks(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const userId = requireUuid(job.subject);
  const chatUserId = chatUserIdFor(userId);
  const { data } = await ctx.admin
    .from("messaging_blocks")
    .select("blocked_user_id")
    .eq("blocker_user_id", userId);
  const desired = new Set(
    ((data ?? []) as { blocked_user_id: string }[]).map((row) => chatUserIdFor(row.blocked_user_id)),
  );
  const actual = new Set(await ctx.provider.listBlockedUsers(chatUserId));

  let blocked = 0;
  let unblocked = 0;
  for (const target of desired) {
    if (!actual.has(target)) {
      await ctx.provider.blockUser(chatUserId, target);
      blocked += 1;
    }
  }
  for (const target of actual) {
    if (!desired.has(target)) {
      await ctx.provider.unblockUser(chatUserId, target);
      unblocked += 1;
    }
  }
  return { detail: { blocked, unblocked } };
}

// ---------------------------------------------------------------------------
// Group channels
// ---------------------------------------------------------------------------

type GroupRow = {
  id: string;
  church_id: string;
  name: string;
  cover_image_url: string | null;
  status: "active" | "archived" | "deleted";
  chat_enabled: boolean;
  chat_posting: "everyone" | "leaders";
  allow_member_media: boolean;
  allow_member_links: boolean;
  safety_profile: "standard" | "youth";
};

async function loadGroup(admin: SupabaseClient, groupId: string): Promise<(GroupRow & { slug: string | null }) | null> {
  const { data } = await admin
    .from("groups")
    .select(
      "id, church_id, name, cover_image_url, status, chat_enabled, chat_posting, allow_member_media, allow_member_links, safety_profile, churches!inner(slug)",
    )
    .eq("id", groupId)
    .maybeSingle();
  if (!data) return null;
  const church = (data as { churches: { slug: string | null } | { slug: string | null }[] }).churches;
  const slug = (Array.isArray(church) ? church[0]?.slug : church?.slug) ?? null;
  return { ...(data as unknown as GroupRow), slug };
}

function source(group: GroupRow & { slug: string | null }): GroupChannelSource {
  return {
    id: group.id,
    churchId: group.church_id,
    churchSlug: group.slug,
    name: group.name,
    coverImageUrl: group.cover_image_url,
    status: group.status,
    chatEnabled: group.chat_enabled,
    chatPosting: group.chat_posting,
    allowMemberMedia: group.allow_member_media,
    allowMemberLinks: group.allow_member_links,
    safetyProfile: group.safety_profile,
  };
}

async function syncGroupChannel(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const groupId = requireUuid(job.subject);
  const group = await loadGroup(ctx.admin, groupId);
  if (!group) return {};

  const channelId = groupChannelId(groupId);
  if (group.status === "deleted") {
    // The binding's deletion queues the provider's (0092 trigger).
    await ctx.admin.from("group_chat_bindings").delete().eq("group_id", groupId);
    return { detail: { deleted: 1 } };
  }

  await ctx.admin
    .from("group_chat_bindings")
    .upsert(
      { group_id: groupId, church_id: group.church_id, channel_id: channelId },
      { onConflict: "group_id", ignoreDuplicates: true },
    );

  const [settings, enabled] = await Promise.all([
    getChurchMessagingSettings(ctx.admin, group.church_id),
    churchesWithGroups(ctx.admin, [group.church_id]),
  ]);
  const spec = source(group);
  const frozen = groupChannelFrozen(spec, settings, enabled.has(group.church_id));

  await ctx.provider.ensureChannel(GROUP_CHANNEL_TYPE, channelId, groupChannelData(spec), {
    frozen,
    configOverrides: groupChannelOverrides(spec, settings),
  });

  const now = ctx.now.toISOString();
  await ctx.admin
    .from("group_chat_bindings")
    .update({
      state: frozen ? "frozen" : "active",
      provisioned_at: now,
      last_synced_at: now,
      updated_at: now,
    })
    .eq("group_id", groupId);

  await ctx.enqueue(group.church_id, "group.members", groupId);
  return { detail: { frozen: frozen ? 1 : 0 } };
}

function channelRoleFor(groupRole: string): ChannelRole {
  return groupRole === "leader" || groupRole === "manager" ? "channel_moderator" : "channel_member";
}

async function syncGroupMembers(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const groupId = requireUuid(job.subject);
  const group = await loadGroup(ctx.admin, groupId);
  if (!group || group.status === "deleted") return {};

  const { data: binding } = await ctx.admin
    .from("group_chat_bindings")
    .select("state")
    .eq("group_id", groupId)
    .maybeSingle();
  if (!binding || binding.state === "pending") {
    // The channel must exist before anyone can be added to it.
    await syncGroupChannel(ctx, { ...job, kind: "group.channel" });
  }

  const { data: memberships } = await ctx.admin
    .from("group_memberships")
    .select("group_role, visitor_accounts!inner(user_id, status)")
    .eq("group_id", groupId)
    .eq("status", "active");

  type Row = {
    group_role: string;
    visitor_accounts: { user_id: string; status: string } | { user_id: string; status: string }[];
  };
  const desiredRoles = new Map<string, { authUserId: string; role: ChannelRole }>();
  for (const row of (memberships ?? []) as Row[]) {
    const account = Array.isArray(row.visitor_accounts) ? row.visitor_accounts[0] : row.visitor_accounts;
    if (!account || account.status !== "active") continue;
    desiredRoles.set(chatUserIdFor(account.user_id), {
      authUserId: account.user_id,
      role: channelRoleFor(row.group_role),
    });
  }

  // Everyone about to be added must exist at the provider, in this tenant.
  const channelId = groupChannelId(groupId);
  const actual = await ctx.provider.listMembers(GROUP_CHANNEL_TYPE, channelId);
  const actualById = new Map(actual.map((member) => [member.chatUserId, member]));

  const missing = [...desiredRoles.entries()].filter(([chatId]) => !actualById.has(chatId));
  let toAdd = missing;
  if (missing.length > 0) {
    const identities = await resolveChatIdentities(
      ctx.admin,
      missing.map(([, value]) => value.authUserId),
    );
    // Only someone who resolves to a live identity *in this church* is added;
    // anyone else is left for the next run, which will see them removed.
    toAdd = missing.filter(([, value]) =>
      identities.get(value.authUserId)?.memberChurchIds.includes(group.church_id),
    );
    await provisionChatUsers(
      ctx.admin,
      ctx.provider,
      toAdd.map(([, value]) => identities.get(value.authUserId)!),
    );
  }

  const additions = toAdd.map(([chatUserId, value]) => ({ chatUserId, channelRole: value.role }));
  const removals = actual
    .filter((member) => member.chatUserId !== "ff_system" && !desiredRoles.has(member.chatUserId))
    .map((member) => member.chatUserId);
  const roleChanges = actual
    .filter((member) => {
      const desired = desiredRoles.get(member.chatUserId);
      return desired && desired.role !== member.channelRole;
    })
    .map((member) => ({ chatUserId: member.chatUserId, channelRole: desiredRoles.get(member.chatUserId)!.role }));

  if (additions.length) await ctx.provider.addMembers(GROUP_CHANNEL_TYPE, channelId, additions);
  if (removals.length) await ctx.provider.removeMembers(GROUP_CHANNEL_TYPE, channelId, removals);
  if (roleChanges.length) await ctx.provider.setMemberRoles(GROUP_CHANNEL_TYPE, channelId, roleChanges);

  // New members get their notification choices and any suspension applied.
  for (const [, value] of toAdd) {
    await ctx.enqueue(group.church_id, "user.push", value.authUserId);
  }
  if (toAdd.length > 0) {
    const { data: restricted } = await ctx.admin
      .from("messaging_restrictions")
      .select("user_id")
      .eq("church_id", group.church_id)
      .is("lifted_at", null)
      .in("user_id", toAdd.map(([, value]) => value.authUserId));
    for (const row of (restricted ?? []) as { user_id: string }[]) {
      await ctx.enqueue(group.church_id, "church.restriction", `${group.church_id}:${row.user_id}`);
    }
  }

  await ctx.admin
    .from("group_chat_bindings")
    .update({ last_synced_at: ctx.now.toISOString() })
    .eq("group_id", groupId);

  return { detail: { added: additions.length, removed: removals.length, roles: roleChanges.length } };
}

async function syncChurchChannels(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const churchId = requireUuid(job.subject);
  const { data } = await ctx.admin
    .from("groups")
    .select("id")
    .eq("church_id", churchId)
    .neq("status", "deleted")
    .limit(2000);
  for (const row of (data ?? []) as { id: string }[]) {
    await ctx.enqueue(churchId, "group.channel", row.id);
  }
  return { detail: { groups: (data ?? []).length } };
}

async function deleteChannel(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const type = job.payload.channelType as ChannelType;
  const id = String(job.payload.channelId ?? "");
  const valid =
    (type === GROUP_CHANNEL_TYPE && /^grp_[0-9a-f]{32}$/.test(id)) ||
    (type === DM_CHANNEL_TYPE && /^dm_[a-z2-7]{30}$/.test(id));
  if (!valid) throw new Error("malformed subject");
  await ctx.provider.deleteChannel(type, id);
  return {};
}

// ---------------------------------------------------------------------------
// Direct conversations
// ---------------------------------------------------------------------------

type DmRow = {
  id: string;
  church_id: string;
  channel_id: string;
  user_low: string;
  user_high: string;
  state: "pending" | "active" | "frozen" | "deleted";
  frozen_reason: string | null;
};

async function syncDirect(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const [scope, rawId] = job.subject.split(":");
  const id = requireUuid(rawId ?? "");
  const PAGE = 500;
  const after = typeof job.payload.after === "string" && UUID.test(job.payload.after) ? job.payload.after : null;
  let query = ctx.admin
    .from("messaging_dm_channels")
    .select("id, church_id, channel_id, user_low, user_high, state, frozen_reason")
    .neq("state", "deleted")
    .order("id", { ascending: true })
    .limit(PAGE);
  if (after) query = query.gt("id", after);
  if (scope === "user") query = query.or(`user_low.eq.${id},user_high.eq.${id}`);
  else if (scope === "church") query = query.eq("church_id", id);
  else if (scope === "dm") query = query.eq("id", id);
  else throw new Error("malformed subject");

  const { data } = await query;
  const rows = (data ?? []) as DmRow[];
  if (rows.length === 0) return {};
  if (rows.length === PAGE) {
    // A church with more conversations than one run should touch continues
    // in the next job, from where this one stopped.
    await ctx.enqueue(rows[0].church_id, "dm.sync", job.subject, { after: rows[rows.length - 1].id });
  }

  let frozenCount = 0;
  for (const churchId of [...new Set(rows.map((row) => row.church_id))]) {
    const churchRows = rows.filter((row) => row.church_id === churchId);
    const [settings, parties, { data: church }] = await Promise.all([
      getChurchMessagingSettings(ctx.admin, churchId),
      loadDmParties(ctx.admin, churchId, churchRows.flatMap((row) => [row.user_low, row.user_high]), ctx.now),
      ctx.admin.from("churches").select("slug").eq("id", churchId).maybeSingle(),
    ]);

    for (const row of churchRows) {
      const low = parties.get(row.user_low);
      const high = parties.get(row.user_high);
      const blocked = await isBlockedEitherWay(ctx.admin, row.user_low, row.user_high);
      const decision =
        low && high
          ? decideDirectMessage({
              policy: settings.dmPolicy,
              messagingEnabled: settings.messagingEnabled,
              initiator: low,
              target: high,
              blocked,
              mode: "continue",
            })
          : ({ allowed: false, reason: "unavailable" } as const);

      const frozen = !decision.allowed;
      const reason = decision.allowed
        ? null
        : decision.reason === "blocked"
          ? "blocked"
          : decision.reason === "restricted"
            ? "restricted"
            : decision.reason === "unavailable"
              ? "left_church"
              : "policy";

      await ensureBindings(ctx.admin, [row.user_low, row.user_high]);
      if (row.state === "pending") {
        const identities = await resolveChatIdentities(ctx.admin, [row.user_low, row.user_high]);
        await provisionChatUsers(ctx.admin, ctx.provider, [...identities.values()]);
      }
      await ctx.provider.ensureChannel(
        DM_CHANNEL_TYPE,
        row.channel_id,
        dmChannelData({ churchId, churchSlug: (church?.slug as string | null) ?? null, channelId: row.channel_id }),
        { frozen, configOverrides: dmChannelOverrides(settings) },
      );
      if (row.state === "pending") {
        await ctx.provider.addMembers(DM_CHANNEL_TYPE, row.channel_id, [
          { chatUserId: chatUserIdFor(row.user_low), channelRole: "channel_member" },
          { chatUserId: chatUserIdFor(row.user_high), channelRole: "channel_member" },
        ]);
      }

      const now = ctx.now.toISOString();
      await ctx.admin
        .from("messaging_dm_channels")
        .update({ state: frozen ? "frozen" : "active", frozen_reason: reason, last_synced_at: now, updated_at: now })
        .eq("id", row.id);
      if (frozen) frozenCount += 1;
    }
  }
  return { detail: { conversations: rows.length, frozen: frozenCount } };
}

// ---------------------------------------------------------------------------
// Restrictions
// ---------------------------------------------------------------------------

async function syncRestriction(ctx: HandlerContext, job: SyncJob): Promise<HandlerResult> {
  const [rawChurch, rawUser] = job.subject.split(":");
  const churchId = requireUuid(rawChurch ?? "");
  const userId = requireUuid(rawUser ?? "");
  const chatUserId = chatUserIdFor(userId);

  const { data: open } = await ctx.admin
    .from("messaging_restrictions")
    .select("id, reason, ends_at")
    .eq("church_id", churchId)
    .eq("user_id", userId)
    .is("lifted_at", null)
    .maybeSingle();

  // A suspension that has run out is lifted by the clock, and recorded so.
  let active = open as { id: string; reason: string | null; ends_at: string | null } | null;
  if (active?.ends_at && Date.parse(active.ends_at) <= ctx.now.getTime()) {
    await ctx.admin
      .from("messaging_restrictions")
      .update({ lifted_at: active.ends_at })
      .eq("id", active.id)
      .is("lifted_at", null);
    active = null;
  }

  const { data: account } = await ctx.admin.from("visitor_accounts").select("id").eq("user_id", userId).maybeSingle();
  const channels: { type: ChannelType; id: string }[] = [];
  if (account) {
    const { data: memberships } = await ctx.admin
      .from("group_memberships")
      .select("group_id")
      .eq("church_id", churchId)
      .eq("account_id", account.id as string)
      .eq("status", "active");
    for (const row of (memberships ?? []) as { group_id: string }[]) {
      channels.push({ type: GROUP_CHANNEL_TYPE, id: groupChannelId(row.group_id) });
    }
  }
  const { data: dms } = await ctx.admin
    .from("messaging_dm_channels")
    .select("channel_id")
    .eq("church_id", churchId)
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
    .neq("state", "deleted");
  for (const row of (dms ?? []) as { channel_id: string }[]) {
    channels.push({ type: DM_CHANNEL_TYPE, id: row.channel_id });
  }

  const minutes = active?.ends_at
    ? Math.max(1, Math.ceil((Date.parse(active.ends_at) - ctx.now.getTime()) / 60_000))
    : null;

  for (const channel of channels) {
    try {
      if (active) {
        await ctx.provider.banInChannel(channel.type, channel.id, chatUserId, {
          reason: active.reason,
          timeoutMinutes: minutes,
        });
      } else {
        await ctx.provider.unbanInChannel(channel.type, channel.id, chatUserId);
      }
    } catch (error) {
      if ((error as { category?: string }).category !== "not_found") throw error;
    }
  }

  // The reconcile that lifts it runs when it ends, not before.
  if (active?.ends_at) {
    const seconds = Math.max(30, Math.ceil((Date.parse(active.ends_at) - ctx.now.getTime()) / 1000) + 5);
    await ctx.enqueue(churchId, "church.restriction", job.subject, {}, seconds);
  }
  await ctx.enqueue(churchId, "dm.sync", `user:${userId}`);
  return { detail: { channels: channels.length, active: active ? 1 : 0 } };
}

export const HANDLERS: Record<string, (ctx: HandlerContext, job: SyncJob) => Promise<HandlerResult>> = {
  "user.sync": syncUser,
  "user.delete": deleteUser,
  "user.devices": syncDevices,
  "user.push": syncPush,
  "user.blocks": syncBlocks,
  "group.channel": syncGroupChannel,
  "group.members": syncGroupMembers,
  "dm.sync": syncDirect,
  "channel.delete": deleteChannel,
  "church.channels": syncChurchChannels,
  "church.restriction": syncRestriction,
};
