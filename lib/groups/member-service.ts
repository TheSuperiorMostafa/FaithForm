import { VisitorError } from "@/lib/faithform/errors";
import { hashInvitationToken } from "@/lib/faithform/invitation-token";
import {
  loadGroupForMember,
  isUuid,
  resolveMemberContext,
  type GroupAccess,
  type MemberContext,
} from "@/lib/groups/context";
import {
  cancelGathering,
  createGathering,
  getAttendanceSheet,
  getGathering,
  listGroupEvents,
  setRsvp,
  submitAttendance,
  updateGathering,
} from "@/lib/groups/gatherings";
import {
  decideRequest,
  issueGroupInvitation,
  joinGroup,
  leaveGroup,
  previewGroupInvitation,
  removeFromGroup,
  setGroupRole,
  type JoinOutcome,
} from "@/lib/groups/membership";
import { canChangeRole, canRemoveMember, capabilitiesFor } from "@/lib/groups/permissions";
import {
  GROUP_COLUMNS,
  buildGroupSummaries,
  labelMemberships,
  messagingAvailableFor,
  type GroupRow,
  type GroupSummary,
} from "@/lib/groups/read-models";
import { describeSchedule, scheduleFromRow } from "@/lib/groups/schedule";
import type {
  ChurchNotificationLevel,
  GroupRole,
  MemberNotificationLevel,
  RsvpResponse,
} from "@/lib/groups/types";
import { decideDirectMessage } from "@/lib/messaging/dm-policy";
import { loadDmParties } from "@/lib/messaging/dm-parties";
import { getChurchMessagingSettings } from "@/lib/messaging/settings";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";
import { decodeCursor, encodeCursor } from "@/lib/mobile/v1/protocol";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Groups for a signed-in member, as the mobile contract shapes it.
 *
 * Every function starts from `resolveMemberContext` — the verified account, a
 * live relationship with the church named by slug, and the Groups feature —
 * and every group from `loadGroupForMember`, which refuses anything the
 * caller may not know exists. Leader actions are then checked against
 * `capabilitiesFor`, the same rules the dashboard uses.
 */

async function viewerFor(ctx: MemberContext) {
  const { data: linked } = await ctx.admin.rpc("linked_member_id", {
    p_account_id: ctx.account.id,
    p_church_id: ctx.church.id,
  });
  return { kind: "member" as const, accountId: ctx.account.id, linkedMemberId: (linked as string | null) ?? null };
}

async function summaryFor(ctx: MemberContext, groupId: string): Promise<GroupSummary | null> {
  const { data } = await ctx.admin
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("id", groupId)
    .eq("church_id", ctx.church.id)
    .maybeSingle();
  if (!data) return null;
  const [summary] = await buildGroupSummaries(ctx.admin, [data as unknown as GroupRow], await viewerFor(ctx), {
    messagingAvailable: await messagingAvailableFor(ctx.admin, ctx.church.id),
  });
  return summary ?? null;
}

function requireCapability(access: GroupAccess, allowed: boolean): void {
  if (!allowed) {
    // A member without the right sees the same answer as for an action that
    // does not exist; an outsider never got this far.
    throw new VisitorError("forbidden", "Only this group's leaders can do that.");
  }
}

function capabilities(access: GroupAccess) {
  return capabilitiesFor(access.actor, {
    memberListVisibility: (access.group.member_list_visibility as "members" | "leaders") ?? "members",
    status: access.group.status,
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function myGroups(userId: string, churchSlug: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const viewer = await viewerFor(ctx);

  const { data: memberships } = await ctx.admin
    .from("group_memberships")
    .select("group_id")
    .eq("church_id", ctx.church.id)
    .eq("status", "active")
    .or(
      viewer.linkedMemberId
        ? `account_id.eq.${ctx.account.id},member_id.eq.${viewer.linkedMemberId}`
        : `account_id.eq.${ctx.account.id}`,
    )
    .limit(200);
  const ids = [...new Set(((memberships ?? []) as { group_id: string }[]).map((m) => m.group_id))];

  const [{ data: groups }, messagingAvailable, settings, parties] = await Promise.all([
    ids.length
      ? ctx.admin
          .from("groups")
          .select(GROUP_COLUMNS)
          .in("id", ids)
          .eq("church_id", ctx.church.id)
          .in("status", ["active", "archived"])
      : Promise.resolve({ data: [] }),
    messagingAvailableFor(ctx.admin, ctx.church.id),
    getChurchMessagingSettings(ctx.admin, ctx.church.id),
    loadDmParties(ctx.admin, ctx.church.id, [ctx.userId]),
  ]);

  const rows = ((groups ?? []) as unknown as GroupRow[]).sort((a, b) => {
    // Active groups first; then the most recently talked-in; then by name.
    // Unread is known only to the chat client, which re-sorts on top of this.
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    const la = a.last_activity_at ? Date.parse(a.last_activity_at) : 0;
    const lb = b.last_activity_at ? Date.parse(b.last_activity_at) : 0;
    if (la !== lb) return lb - la;
    return a.name.localeCompare(b.name);
  });

  const party = parties.get(ctx.userId);
  const dm = party
    ? decideDirectMessage({
        policy: settings.dmPolicy,
        messagingEnabled: settings.messagingEnabled,
        initiator: party,
        target: { ...party, inYouthGroup: false, restricted: false },
        blocked: false,
        mode: "continue",
      })
    : { allowed: false as const };

  return {
    items: await buildGroupSummaries(ctx.admin, rows, viewer, { messagingAvailable }),
    directMessagesEnabled: messagingAvailable && dm.allowed,
    messagingAvailable,
  };
}

export type DiscoverFilters = {
  query?: string | null;
  typeId?: string | null;
  dayOfWeek?: number | null;
  campusId?: string | null;
  openOnly?: boolean;
  cursor?: string | null;
  limit?: number;
};

export async function discoverGroups(userId: string, churchSlug: string, filters: DiscoverFilters) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const cursor = decodeCursor(filters.cursor, "groups");
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
  const query = filters.query?.trim().slice(0, 80) || null;

  const { data, error } = await ctx.admin.rpc("discover_groups", {
    p_church_id: ctx.church.id,
    p_query: query,
    p_type_id: isUuid(filters.typeId) ? filters.typeId : null,
    p_day_of_week:
      typeof filters.dayOfWeek === "number" && filters.dayOfWeek >= 0 && filters.dayOfWeek <= 6
        ? filters.dayOfWeek
        : null,
    p_campus_id: isUuid(filters.campusId) ? filters.campusId : null,
    p_open_only: Boolean(filters.openOnly),
    p_cursor_name: cursor?.[0] ?? null,
    p_cursor_id: cursor?.[1] && isUuid(cursor[1]) ? cursor[1] : null,
    p_limit: limit + 1,
  });
  if (error) throw new VisitorError("unavailable", "Could not load groups.");

  const found = (data ?? []) as { id: string; cursor_name: string }[];
  const page = found.slice(0, limit);
  const { data: groups } = page.length
    ? await ctx.admin.from("groups").select(GROUP_COLUMNS).in("id", page.map((row) => row.id))
    : { data: [] };
  const byId = new Map(((groups ?? []) as unknown as GroupRow[]).map((row) => [row.id, row]));
  const ordered = page.map((row) => byId.get(row.id)).filter((row): row is GroupRow => Boolean(row));

  const last = page[page.length - 1];
  return {
    items: await buildGroupSummaries(ctx.admin, ordered, await viewerFor(ctx), {
      messagingAvailable: await messagingAvailableFor(ctx.admin, ctx.church.id),
    }),
    nextCursor: found.length > limit && last ? encodeCursor("groups", [last.cursor_name, last.id]) : null,
  };
}

export async function groupFilters(userId: string, churchSlug: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const { data: listed } = await ctx.admin
    .from("groups")
    .select("id, type_id, campus_id")
    .eq("church_id", ctx.church.id)
    .eq("status", "active")
    .eq("visibility", "public")
    .limit(2000);
  const rows = (listed ?? []) as { id: string; type_id: string | null; campus_id: string | null }[];
  const typeIds = [...new Set(rows.map((r) => r.type_id).filter((v): v is string => Boolean(v)))];
  const campusIds = [...new Set(rows.map((r) => r.campus_id).filter((v): v is string => Boolean(v)))];

  const [types, campuses, schedules] = await Promise.all([
    typeIds.length
      ? ctx.admin.from("group_types").select("id, name, icon, sort_order").in("id", typeIds).eq("is_active", true).order("sort_order")
      : Promise.resolve({ data: [] }),
    campusIds.length
      ? ctx.admin.from("church_campuses").select("id, name").in("id", campusIds).eq("is_active", true).eq("is_public", true)
      : Promise.resolve({ data: [] }),
    rows.length
      ? ctx.admin.from("group_meeting_schedules").select("day_of_week").in("group_id", rows.map((r) => r.id)).eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    types: ((types.data ?? []) as { id: string; name: string; icon: string }[]).map((t) => ({ id: t.id, name: t.name, icon: t.icon })),
    campuses: ((campuses.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name })),
    days: [...new Set(((schedules.data ?? []) as { day_of_week: number }[]).map((s) => Number(s.day_of_week)))].sort(),
  };
}

// ---------------------------------------------------------------------------
// One group
// ---------------------------------------------------------------------------

export async function groupDetail(userId: string, churchSlug: string, groupId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, GROUP_COLUMNS);
  const group = access.group as unknown as GroupRow;
  const caps = capabilities(access);
  const isMember = Boolean(access.membership);

  const [summary, leaders, schedules, events] = await Promise.all([
    summaryFor(ctx, groupId),
    ctx.admin
      .from("group_memberships")
      .select("id, member_id, account_id, group_role")
      .eq("group_id", groupId)
      .eq("status", "active")
      .eq("group_role", "leader")
      .limit(12),
    ctx.admin
      .from("group_meeting_schedules")
      .select("id, frequency, day_of_week, week_of_month, start_time, duration_minutes, timezone, starts_on, ends_on, is_active")
      .eq("group_id", groupId)
      .eq("is_active", true)
      .order("created_at"),
    listGroupEvents(ctx.admin, {
      churchId: ctx.church.id,
      groupId,
      when: "upcoming",
      accountId: ctx.account.id,
      limit: 3,
    }),
  ]);
  if (!summary) throw new VisitorError("group_not_found", "Group not found.");

  const leaderRows = (leaders.data ?? []) as { id: string; member_id: string | null; account_id: string | null; group_role: string }[];
  const labels = await labelMemberships(ctx.admin, leaderRows);
  const showLocation = group.location_visibility === "public" || isMember;

  return {
    group: summary,
    description: group.description,
    leaders: leaderRows.map((row) => {
      const label = labels.get(row.id);
      return {
        name: label?.name ?? "Leader",
        avatarUrl: label?.avatarUrl ?? null,
        groupRole: row.group_role,
        chatUserId: label?.chatUserId ?? null,
      };
    }),
    schedules: ((schedules.data ?? []) as Record<string, unknown>[]).map(scheduleFromRow).map((s) => ({
      text: describeSchedule(s),
      frequency: s.frequency,
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      durationMinutes: s.durationMinutes,
      timezone: s.timezone,
    })),
    location:
      group.location_name || group.location_address || group.online_meeting_url
        ? {
            name: showLocation ? group.location_name : null,
            address: showLocation ? group.location_address : null,
            onlineMeetingUrl: isMember ? group.online_meeting_url : null,
            membersOnly: !showLocation || Boolean(group.online_meeting_url && !isMember),
          }
        : null,
    // The group's own gatherings are for its members; others see that it
    // meets (the schedule) and when next (the summary), not the whole calendar.
    upcomingEvents: isMember ? events.items : [],
    capabilities: {
      canViewMembers: caps.canViewMembers,
      canManageMembers: caps.canManageMembers,
      canManageRequests: caps.canManageRequests,
      canInvite: caps.canInvite,
      canManageRoles: caps.canManageRoles,
      canEditDetails: caps.canEditDetails,
      canManageEvents: caps.canManageEvents,
      canTakeAttendance: caps.canTakeAttendance,
      canModerateChat: caps.canModerateChat,
    },
    pendingRequestCount: caps.canManageRequests ? group.pending_request_count : 0,
    notificationLevel: access.membership?.notification_level ?? null,
    isArchived: group.status === "archived",
    chatPosting: group.chat_posting,
    memberListVisibility: group.member_list_visibility,
  };
}

/**
 * A manager edits their own group. What they may change is the contract's
 * `UpdateGroupDetailsRequest`; visibility, safety profile and category stay
 * with church staff. A stale `expectedVersion` is a conflict, never a silent
 * overwrite of someone else's edit.
 */
export async function updateDetails(
  userId: string,
  churchSlug: string,
  groupId: string,
  values: {
    expectedVersion: number;
    name: string;
    description: string | null;
    enrollment: GroupRow["enrollment"];
    capacity: number | null;
    locationName: string | null;
    locationAddress: string | null;
    onlineMeetingUrl: string | null;
    chatPosting: GroupRow["chat_posting"];
    memberListVisibility: GroupRow["member_list_visibility"];
  },
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, GROUP_COLUMNS);
  requireCapability(access, capabilities(access).canEditDetails);
  const group = access.group as unknown as GroupRow;

  const meetingUrl = values.onlineMeetingUrl?.trim() || null;
  if (meetingUrl && !/^https:\/\/[^\s]+$/i.test(meetingUrl)) {
    throw new VisitorError("invalid_input", "Meeting links must start with https://");
  }
  if (values.capacity !== null && values.capacity < group.member_count) {
    throw new VisitorError(
      "invalid_input",
      `This group already has ${group.member_count} members. Capacity can't be lower than that.`,
    );
  }

  const { data, error } = await ctx.admin
    .from("groups")
    .update({
      name: values.name.trim(),
      description: values.description?.trim() || null,
      enrollment: values.enrollment,
      capacity: values.capacity,
      location_name: values.locationName?.trim() || null,
      location_address: values.locationAddress?.trim() || null,
      online_meeting_url: meetingUrl,
      chat_posting: values.chatPosting,
      member_list_visibility: values.memberListVisibility,
      updated_by: userId,
    })
    .eq("id", group.id)
    .eq("church_id", ctx.church.id)
    .eq("status", "active")
    .eq("version", values.expectedVersion)
    .select("id");
  if (error) throw new VisitorError("unavailable", "Could not save the group.");
  if (!data || data.length === 0) {
    throw new VisitorError("conflict", "This group changed while you were editing. Reload to see the latest.");
  }
  await ctx.admin.rpc("log_group_event", {
    p_church_id: ctx.church.id,
    p_group_id: group.id,
    p_action: "settings_changed",
    p_actor_type: "leader",
    p_actor_user_id: userId,
    p_membership_id: access.membership?.id ?? null,
    p_account_id: ctx.account.id,
    p_member_id: null,
    p_detail: {},
  });
  await syncNow([dedupeKey("group.channel", group.id)], { budgetMs: 3_000 });
  return groupDetail(userId, churchSlug, groupId);
}

// ---------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------

export async function join(userId: string, churchSlug: string, groupId: string, message: string | null) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, name, status, visibility, member_list_visibility");
  const outcome: JoinOutcome = await joinGroup(ctx.admin, {
    churchId: ctx.church.id,
    churchSlug: ctx.church.slug,
    groupId,
    groupName: access.group.name as string,
    accountId: ctx.account.id,
    requesterName: ctx.account.displayName,
    message,
  });
  return { outcome, group: await summaryFor(ctx, groupId) };
}

export async function leave(userId: string, churchSlug: string, groupId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility");
  const outcome = await leaveGroup(ctx.admin, groupId, ctx.account.id);
  // After leaving a private group, it is no longer the caller's to see.
  let group: GroupSummary | null = null;
  try {
    await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility");
    group = await summaryFor(ctx, groupId);
  } catch {
    group = null;
  }
  return { outcome, group };
}

export async function previewInvitation(rawToken: string) {
  return previewGroupInvitation(createAdminClient(), rawToken);
}

/**
 * Redeems a share link. The person must already belong to the group's church
 * in the app (one church per account, 0090): a group link never quietly
 * replaces someone's church. The app shows the church first when it differs.
 */
export async function acceptInvitation(userId: string, rawToken: string) {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(rawToken)) {
    throw new VisitorError("invitation_invalid", "That invitation is not valid.");
  }
  const admin = createAdminClient();
  const preview = await previewGroupInvitation(admin, rawToken);
  if (!preview) throw new VisitorError("invitation_expired", "That invitation has expired or was withdrawn.");

  const ctx = await resolveMemberContext(userId, preview.churchSlug);
  const outcome = await joinGroup(ctx.admin, {
    churchId: ctx.church.id,
    churchSlug: ctx.church.slug,
    groupId: preview.groupId,
    groupName: preview.groupName,
    accountId: ctx.account.id,
    requesterName: ctx.account.displayName,
    invitationTokenHash: hashInvitationToken(rawToken),
  });
  let group: GroupSummary | null = null;
  if (outcome === "joined" || outcome === "already_member") group = await summaryFor(ctx, preview.groupId);
  return { outcome, group, churchSlug: ctx.church.slug };
}

// ---------------------------------------------------------------------------
// Leading
// ---------------------------------------------------------------------------

export async function listMembers(
  userId: string,
  churchSlug: string,
  groupId: string,
  input: { query?: string | null; cursor?: string | null; limit?: number },
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility, member_list_visibility, member_count");
  requireCapability(access, capabilities(access).canViewMembers);

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Number(decodeCursor(input.cursor, "group_members")?.[0] ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) {
    throw new VisitorError("invalid_input", "Invalid cursor.");
  }

  const { data } = await ctx.admin
    .from("group_memberships")
    .select("id, member_id, account_id, group_role, joined_at")
    .eq("group_id", groupId)
    .eq("church_id", ctx.church.id)
    .eq("status", "active")
    .limit(5000);
  const rows = (data ?? []) as { id: string; member_id: string | null; account_id: string | null; group_role: GroupRole; joined_at: string }[];
  const labels = await labelMemberships(ctx.admin, rows);

  const needle = input.query?.trim().toLowerCase() ?? "";
  const rank = (role: GroupRole) => (role === "leader" ? 0 : role === "manager" ? 1 : 2);
  const everyone = rows
    .map((row) => ({ row, label: labels.get(row.id)! }))
    .filter(({ label }) => !needle || label.name.toLowerCase().includes(needle))
    .sort((a, b) => rank(a.row.group_role) - rank(b.row.group_role) || a.label.name.localeCompare(b.label.name));

  const page = everyone.slice(offset, offset + limit);
  return {
    items: page.map(({ row, label }) => ({
      membershipId: row.id,
      name: label.name,
      avatarUrl: label.avatarUrl,
      groupRole: row.group_role,
      joinedAt: new Date(row.joined_at).toISOString(),
      chatUserId: label.chatUserId,
      isYou: row.account_id === ctx.account.id,
    })),
    nextCursor: offset + limit < everyone.length ? encodeCursor("group_members", [String(offset + limit)]) : null,
    total: everyone.length,
  };
}

export async function listRequests(userId: string, churchSlug: string, groupId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility, member_list_visibility");
  requireCapability(access, capabilities(access).canManageRequests);

  const { data } = await ctx.admin
    .from("group_join_requests")
    .select("id, account_id, message, created_at")
    .eq("group_id", groupId)
    .eq("church_id", ctx.church.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  const rows = (data ?? []) as { id: string; account_id: string; message: string | null; created_at: string }[];
  const labels = await labelMemberships(
    ctx.admin,
    rows.map((row) => ({ id: row.id, member_id: null, account_id: row.account_id })),
  );
  return {
    items: rows.map((row) => ({
      requestId: row.id,
      name: labels.get(row.id)?.name ?? "Someone",
      avatarUrl: labels.get(row.id)?.avatarUrl ?? null,
      message: row.message,
      requestedAt: new Date(row.created_at).toISOString(),
    })),
    nextCursor: null,
  };
}

export async function decide(
  userId: string,
  churchSlug: string,
  groupId: string,
  requestId: string,
  decision: "approve" | "decline",
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility, member_list_visibility");
  requireCapability(access, capabilities(access).canManageRequests);
  if (!isUuid(requestId)) throw new VisitorError("group_not_found", "That request was not found.");
  const outcome = await decideRequest(ctx.admin, {
    churchId: ctx.church.id,
    churchSlug: ctx.church.slug,
    groupId,
    requestId,
    decision,
    actor: { type: "leader", userId },
  });
  return { outcome };
}

async function loadTargetMembership(ctx: MemberContext, groupId: string, membershipId: string) {
  if (!isUuid(membershipId)) throw new VisitorError("group_not_found", "That member was not found.");
  const { data } = await ctx.admin
    .from("group_memberships")
    .select("id, account_id, group_role, status")
    .eq("id", membershipId)
    .eq("group_id", groupId)
    .eq("church_id", ctx.church.id)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new VisitorError("group_not_found", "That member was not found.");
  return data as { id: string; account_id: string | null; group_role: GroupRole };
}

export async function removeMember(
  userId: string,
  churchSlug: string,
  groupId: string,
  membershipId: string,
  input: { ban: boolean; reason: string | null },
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility, member_list_visibility");
  requireCapability(access, capabilities(access).canManageMembers);
  const target = await loadTargetMembership(ctx, groupId, membershipId);
  const isSelf = target.account_id === ctx.account.id;
  if (!canRemoveMember(access.actor, target.group_role, isSelf)) {
    throw new VisitorError("forbidden", isSelf ? "Leave the group instead." : "You can't remove this person.");
  }
  const outcome = await removeFromGroup(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    membershipId,
    ban: input.ban,
    reason: input.reason,
    actor: { type: "leader", userId },
  });
  return { outcome };
}

export async function changeRole(
  userId: string,
  churchSlug: string,
  groupId: string,
  membershipId: string,
  groupRole: GroupRole,
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility, member_list_visibility");
  requireCapability(access, capabilities(access).canManageRoles);
  const target = await loadTargetMembership(ctx, groupId, membershipId);
  if (!canChangeRole(access.actor, target.group_role, groupRole, target.account_id === ctx.account.id)) {
    throw new VisitorError("forbidden", "You can't change this person's role.");
  }
  const outcome = await setGroupRole(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    membershipId,
    groupRole,
    actor: { type: "leader", userId },
  });
  return { outcome };
}

export async function createInvitation(userId: string, churchSlug: string, groupId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility, member_list_visibility");
  requireCapability(access, capabilities(access).canInvite);
  const issued = await issueGroupInvitation(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    actor: { type: "leader", userId },
    baseUrl: getCanonicalSiteUrl(),
  });
  return { url: issued.url, expiresAt: issued.expiresAt, maxUses: issued.maxUses };
}

// ---------------------------------------------------------------------------
// Gatherings
// ---------------------------------------------------------------------------

async function memberAccess(userId: string, churchSlug: string, groupId: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, name, status, visibility, member_list_visibility");
  // A group's calendar is its members'.
  if (!access.membership) throw new VisitorError("forbidden", "Join the group to see its gatherings.");
  return { ctx, access, caps: capabilities(access) };
}

export async function listEvents(
  userId: string,
  churchSlug: string,
  groupId: string,
  input: { when: "upcoming" | "past"; cursor: string | null; limit?: number },
) {
  const { ctx } = await memberAccess(userId, churchSlug, groupId);
  const raw = decodeCursor(input.cursor, `group_events_${input.when}`);
  const page = await listGroupEvents(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    when: input.when,
    accountId: ctx.account.id,
    cursor: raw ? { at: raw[0], id: raw[1] } : null,
    limit: input.limit,
  });
  return {
    items: page.items,
    nextCursor: page.nextCursor
      ? encodeCursor(`group_events_${input.when}`, [page.nextCursor.at, page.nextCursor.id])
      : null,
  };
}

export async function eventDetail(userId: string, churchSlug: string, groupId: string, eventId: string) {
  const { ctx, access, caps } = await memberAccess(userId, churchSlug, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  const detail = await getGathering(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    eventId,
    accountId: ctx.account.id,
    includeAttendance: caps.canTakeAttendance,
  });
  return {
    event: detail.event,
    groupName: access.group.name as string,
    description: detail.description,
    locationAddress: detail.locationAddress,
    onlineMeetingUrl: detail.onlineMeetingUrl,
    rsvpCounts: detail.rsvpCounts,
    attendance: detail.attendance,
    canEdit: caps.canManageEvents && !detail.event.isCancelled,
    canTakeAttendance: caps.canTakeAttendance && !detail.event.isCancelled,
  };
}

export async function createEvent(userId: string, churchSlug: string, groupId: string, values: unknown) {
  const { ctx, access, caps } = await memberAccess(userId, churchSlug, groupId);
  requireCapability(access, caps.canManageEvents);
  const eventId = await createGathering(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    churchTimezone: ctx.church.timezone,
    actor: { type: "leader", userId },
    values,
  });
  return eventDetail(userId, churchSlug, groupId, eventId);
}

export async function updateEvent(userId: string, churchSlug: string, groupId: string, eventId: string, values: unknown) {
  const { ctx, access, caps } = await memberAccess(userId, churchSlug, groupId);
  requireCapability(access, caps.canManageEvents);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  await updateGathering(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    eventId,
    churchTimezone: ctx.church.timezone,
    actor: { type: "leader", userId },
    values,
  });
  return eventDetail(userId, churchSlug, groupId, eventId);
}

export async function cancelEvent(userId: string, churchSlug: string, groupId: string, eventId: string, reason: string | null) {
  const { ctx, access, caps } = await memberAccess(userId, churchSlug, groupId);
  requireCapability(access, caps.canManageEvents);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  await cancelGathering(ctx.admin, {
    churchId: ctx.church.id,
    churchSlug: ctx.church.slug,
    groupId,
    groupName: access.group.name as string,
    eventId,
    reason,
    actor: { type: "leader", userId },
  });
  return eventDetail(userId, churchSlug, groupId, eventId);
}

export async function rsvp(userId: string, churchSlug: string, groupId: string, eventId: string, response: RsvpResponse) {
  const { ctx } = await memberAccess(userId, churchSlug, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  await setRsvp(ctx.admin, { churchId: ctx.church.id, groupId, eventId, accountId: ctx.account.id, response });
  return eventDetail(userId, churchSlug, groupId, eventId);
}

export async function attendanceSheet(userId: string, churchSlug: string, groupId: string, eventId: string) {
  const { ctx, access, caps } = await memberAccess(userId, churchSlug, groupId);
  requireCapability(access, caps.canTakeAttendance);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  const sheet = await getAttendanceSheet(ctx.admin, { churchId: ctx.church.id, groupId, eventId });
  return {
    eventId: sheet.eventId,
    title: sheet.title,
    startsAt: sheet.startsAt,
    timezone: sheet.timezone,
    taken: sheet.taken,
    entries: sheet.entries.map((entry) => ({
      membershipId: entry.membershipId,
      name: entry.name,
      avatarUrl: entry.avatarUrl,
      groupRole: entry.groupRole,
      present: entry.present,
      recordable: entry.recordable,
    })),
    presentCount: sheet.presentCount,
    absentCount: sheet.absentCount,
    guestCount: sheet.guestCount,
    firstTimeGuestCount: sheet.firstTimeGuestCount,
    notes: sheet.notes,
    recordableUntil: sheet.recordableUntil,
    canRecord: sheet.canRecord,
    lockedReason: sheet.lockedReason,
  };
}

export async function recordAttendance(
  userId: string,
  churchSlug: string,
  groupId: string,
  eventId: string,
  idempotencyKey: string,
  values: unknown,
) {
  const { ctx, access, caps } = await memberAccess(userId, churchSlug, groupId);
  requireCapability(access, caps.canTakeAttendance);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  await submitAttendance(ctx.admin, {
    churchId: ctx.church.id,
    groupId,
    eventId,
    actor: { type: "leader", userId },
    idempotencyKey,
    values,
  });
  return attendanceSheet(userId, churchSlug, groupId, eventId);
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export async function messagingPreferences(userId: string, churchSlug: string) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const [{ data: global }, { data: memberships }] = await Promise.all([
    ctx.admin
      .from("messaging_notification_preferences")
      .select("level")
      .eq("account_id", ctx.account.id)
      .eq("church_id", ctx.church.id)
      .maybeSingle(),
    ctx.admin
      .from("group_memberships")
      .select("group_id, notification_level, groups!inner(name, status)")
      .eq("account_id", ctx.account.id)
      .eq("church_id", ctx.church.id)
      .eq("status", "active")
      .limit(200),
  ]);
  type Row = { group_id: string; notification_level: string; groups: { name: string; status: string } | { name: string; status: string }[] };
  return {
    level: ((global?.level as string | undefined) ?? "all") as ChurchNotificationLevel,
    groups: ((memberships ?? []) as Row[])
      .map((row) => {
        const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
        return { groupId: row.group_id, groupName: group?.name ?? "Group", level: row.notification_level, status: group?.status };
      })
      .filter((row) => row.status !== "deleted")
      .map(({ groupId, groupName, level }) => ({ groupId, groupName, level }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName)),
  };
}

export async function setMessagingLevel(userId: string, churchSlug: string, level: ChurchNotificationLevel) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const { error } = await ctx.admin.from("messaging_notification_preferences").upsert(
    { account_id: ctx.account.id, church_id: ctx.church.id, level, updated_at: new Date().toISOString() },
    { onConflict: "account_id,church_id" },
  );
  if (error) throw new VisitorError("unavailable", "Could not save that preference.");
  return messagingPreferences(userId, churchSlug);
}

export async function setGroupNotificationLevel(
  userId: string,
  churchSlug: string,
  groupId: string,
  level: MemberNotificationLevel,
) {
  const ctx = await resolveMemberContext(userId, churchSlug);
  const access = await loadGroupForMember(ctx, groupId, "id, church_id, status, visibility");
  if (!access.membership) throw new VisitorError("forbidden", "Join the group first.");
  const { error } = await ctx.admin
    .from("group_memberships")
    .update({ notification_level: level, updated_at: new Date().toISOString() })
    .eq("id", access.membership.id)
    .eq("church_id", ctx.church.id);
  if (error) throw new VisitorError("unavailable", "Could not save that preference.");
  return messagingPreferences(userId, churchSlug);
}
