import { VisitorError } from "@/lib/faithform/errors";
import { isUuid } from "@/lib/groups/context";
import {
  addPeopleToGroup,
  decideRequest,
  issueGroupInvitation,
  removeFromGroup,
  revokeGroupInvitation,
  setGroupRole,
  type DecideOutcome,
} from "@/lib/groups/membership";
import { labelMemberships } from "@/lib/groups/read-models";
import { GROUP_ROLES, type GroupRole } from "@/lib/groups/types";
import { loadStaffGroup, staffActor, type StaffContext } from "@/lib/groups/staff/context";
import { getCanonicalSiteUrl } from "@/lib/site-url";

/**
 * Who is in a group, as church staff manage it: the roster, adding people
 * from People, roles, removals and bans, join requests, and invitation links.
 *
 * Staff act on any group of their own church with the `staff` actor type, so
 * the audit trail says who did it and in which capacity. Every change is one
 * atomic command in 0091.
 */

export type StaffMemberRow = {
  membershipId: string;
  name: string;
  avatarUrl: string | null;
  role: GroupRole;
  joinedAt: string;
  source: string;
  hasApp: boolean;
  memberId: string | null;
  attendedRecent: number | null;
  recentGatherings: number | null;
  lastAttendedAt: string | null;
};

export async function listStaffMembers(
  ctx: StaffContext,
  groupId: string,
  options: { query?: string | null; role?: GroupRole | null } = {},
): Promise<{ items: StaffMemberRow[]; lookback: number }> {
  const group = await loadStaffGroup(ctx, groupId);
  const LOOKBACK = 6;
  const [{ data }, { data: participation }] = await Promise.all([
    ctx.admin
      .from("group_memberships")
      .select("id, member_id, account_id, group_role, joined_at, source")
      .eq("group_id", group.id)
      .eq("church_id", ctx.churchId)
      .eq("status", "active")
      .limit(5000),
    ctx.admin.rpc("group_member_participation", {
      p_group_id: group.id,
      p_church_id: ctx.churchId,
      p_lookback: LOOKBACK,
    }),
  ]);
  const rows = (data ?? []) as {
    id: string;
    member_id: string | null;
    account_id: string | null;
    group_role: GroupRole;
    joined_at: string;
    source: string;
  }[];
  const labels = await labelMemberships(ctx.admin, rows);
  const byMembership = new Map(
    ((participation ?? []) as { membership_id: string; attended: number; expected: number; last_attended_at: string | null }[]).map((p) => [p.membership_id, p]),
  );

  const needle = options.query?.trim().toLowerCase() ?? "";
  const rank = (role: GroupRole) => (role === "leader" ? 0 : role === "manager" ? 1 : 2);
  const items = rows
    .filter((row) => !options.role || row.group_role === options.role)
    .map((row) => {
      const label = labels.get(row.id);
      const p = byMembership.get(row.id);
      return {
        membershipId: row.id,
        name: label?.name ?? "Church member",
        avatarUrl: label?.avatarUrl ?? null,
        role: row.group_role,
        joinedAt: new Date(row.joined_at).toISOString(),
        source: row.source,
        hasApp: Boolean(row.account_id),
        memberId: row.member_id,
        attendedRecent: p ? Number(p.attended) : null,
        recentGatherings: p ? Number(p.expected) : null,
        lastAttendedAt: p?.last_attended_at ? new Date(p.last_attended_at).toISOString() : null,
      };
    })
    .filter((row) => !needle || row.name.toLowerCase().includes(needle))
    .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
  return { items, lookback: LOOKBACK };
}

/** People on the church's roster who are not already in this group. */
export async function searchPeopleForGroup(
  ctx: StaffContext,
  groupId: string,
  query: string,
): Promise<{ memberId: string; name: string; photoUrl: string | null; hasApp: boolean }[]> {
  const group = await loadStaffGroup(ctx, groupId);
  const needle = query.trim().slice(0, 80);
  if (needle.length < 1) return [];

  // Names are letters, digits, apostrophes, hyphens and dots. Everything else
  // is dropped before a word reaches a filter string, so no input can close
  // the value, add a condition, or become a wildcard.
  const words = needle
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'.-]/gu, ""))
    .filter(Boolean)
    .slice(0, 3);
  if (words.length === 0) return [];
  let search = ctx.admin
    .from("members")
    .select("id, first_name, last_name, photo_url")
    .eq("church_id", ctx.churchId)
    .eq("is_active", true)
    .order("first_name", { ascending: true })
    .limit(40);
  // Each word must match a first or last name.
  for (const word of words) {
    search = search.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`);
  }
  const [{ data: people }, { data: existing }] = await Promise.all([
    search,
    ctx.admin
      .from("group_memberships")
      .select("member_id")
      .eq("group_id", group.id)
      .eq("status", "active")
      .not("member_id", "is", null),
  ]);
  const inGroup = new Set(((existing ?? []) as { member_id: string }[]).map((r) => r.member_id));
  const candidates = ((people ?? []) as { id: string; first_name: string; last_name: string; photo_url: string | null }[]).filter(
    (p) => !inGroup.has(p.id),
  );
  const { data: links } = candidates.length
    ? await ctx.admin
        .from("visitor_people_links")
        .select("member_id")
        .in("member_id", candidates.map((c) => c.id))
        .is("revoked_at", null)
    : { data: [] };
  const linked = new Set(((links ?? []) as { member_id: string }[]).map((l) => l.member_id));
  return candidates.slice(0, 20).map((p) => ({
    memberId: p.id,
    name: `${p.first_name} ${p.last_name}`.replace(/\s+/g, " ").trim() || "Unnamed person",
    photoUrl: p.photo_url && /^https:\/\//.test(p.photo_url) ? p.photo_url : null,
    hasApp: linked.has(p.id),
  }));
}

export async function addStaffMembers(
  ctx: StaffContext,
  groupId: string,
  input: { memberIds: string[]; role: GroupRole; allowOverCapacity?: boolean },
) {
  const group = await loadStaffGroup(ctx, groupId);
  if (group.status !== "active") throw new VisitorError("conflict", "Restore this group before adding people.");
  if (!(GROUP_ROLES as readonly string[]).includes(input.role)) throw new VisitorError("invalid_input", "Choose a role.");
  const memberIds = [...new Set(input.memberIds.filter(isUuid))].slice(0, 200);
  if (memberIds.length === 0) throw new VisitorError("invalid_input", "Choose at least one person.");
  const capacityLeft = group.capacity === null ? Infinity : group.capacity - group.member_count;
  if (!input.allowOverCapacity && memberIds.length > capacityLeft) {
    throw new VisitorError(
      "conflict",
      capacityLeft <= 0
        ? "This group is full. Raise its capacity or add them anyway."
        : `Only ${capacityLeft} more ${capacityLeft === 1 ? "person fits" : "people fit"} in this group.`,
    );
  }
  return addPeopleToGroup(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    memberIds,
    groupRole: input.role,
    actor: staffActor(ctx),
    allowOverCapacity: Boolean(input.allowOverCapacity),
  });
}

export async function removeStaffMembers(
  ctx: StaffContext,
  groupId: string,
  input: { membershipIds: string[]; ban: boolean; reason: string | null },
): Promise<{ removed: number }> {
  const group = await loadStaffGroup(ctx, groupId);
  const ids = [...new Set(input.membershipIds.filter(isUuid))].slice(0, 200);
  let removed = 0;
  for (const membershipId of ids) {
    const outcome = await removeFromGroup(ctx.admin, {
      churchId: ctx.churchId,
      groupId: group.id,
      membershipId,
      ban: input.ban,
      reason: input.reason?.trim().slice(0, 500) || null,
      actor: staffActor(ctx),
    });
    if (outcome !== "not_found") removed += 1;
  }
  return { removed };
}

export async function setStaffMemberRole(ctx: StaffContext, groupId: string, membershipId: string, role: GroupRole) {
  const group = await loadStaffGroup(ctx, groupId);
  if (!(GROUP_ROLES as readonly string[]).includes(role)) throw new VisitorError("invalid_input", "Choose a role.");
  if (!isUuid(membershipId)) throw new VisitorError("group_not_found", "That member was not found.");
  const outcome = await setGroupRole(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    membershipId,
    groupRole: role,
    actor: staffActor(ctx),
  });
  if (outcome === "not_found") throw new VisitorError("group_not_found", "That member was not found.");
  return { outcome };
}

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

export async function listStaffBans(ctx: StaffContext, groupId: string) {
  const group = await loadStaffGroup(ctx, groupId);
  const { data } = await ctx.admin
    .from("group_bans")
    .select("id, account_id, member_id, reason, created_at")
    .eq("group_id", group.id)
    .eq("church_id", ctx.churchId)
    .is("lifted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as { id: string; account_id: string | null; member_id: string | null; reason: string | null; created_at: string }[];
  const labels = await labelMemberships(ctx.admin, rows);
  return rows.map((row) => ({
    banId: row.id,
    name: labels.get(row.id)?.name ?? "Church member",
    reason: row.reason,
    bannedAt: new Date(row.created_at).toISOString(),
  }));
}

export async function liftStaffBan(ctx: StaffContext, groupId: string, banId: string): Promise<void> {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(banId)) throw new VisitorError("group_not_found", "That ban was not found.");
  const { data } = await ctx.admin
    .from("group_bans")
    .update({ lifted_at: new Date().toISOString(), lifted_by: ctx.userId })
    .eq("id", banId)
    .eq("group_id", group.id)
    .eq("church_id", ctx.churchId)
    .is("lifted_at", null)
    .select("account_id, member_id");
  const row = (data ?? [])[0] as { account_id: string | null; member_id: string | null } | undefined;
  if (!row) throw new VisitorError("group_not_found", "That ban was not found.");
  await ctx.admin.rpc("log_group_event", {
    p_church_id: ctx.churchId,
    p_group_id: group.id,
    p_action: "ban_lifted",
    p_actor_type: "staff",
    p_actor_user_id: ctx.userId,
    p_membership_id: null,
    p_account_id: row.account_id,
    p_member_id: row.member_id,
    p_detail: {},
  });
}

// ---------------------------------------------------------------------------
// Join requests
// ---------------------------------------------------------------------------

export type StaffRequestRow = {
  requestId: string;
  groupId: string;
  groupName: string;
  name: string;
  avatarUrl: string | null;
  message: string | null;
  requestedAt: string;
};

/** Pending requests for one group, or — for the dashboard's inbox — every group. */
export async function listStaffRequests(ctx: StaffContext, groupId: string | null): Promise<StaffRequestRow[]> {
  let query = ctx.admin
    .from("group_join_requests")
    .select("id, group_id, account_id, message, created_at, groups!inner(name, status)")
    .eq("church_id", ctx.churchId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(300);
  if (groupId) {
    const group = await loadStaffGroup(ctx, groupId);
    query = query.eq("group_id", group.id);
  }
  const { data } = await query;
  type Row = {
    id: string;
    group_id: string;
    account_id: string;
    message: string | null;
    created_at: string;
    groups: { name: string; status: string } | { name: string; status: string }[];
  };
  const rows = ((data ?? []) as Row[]).filter((row) => {
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    return group?.status === "active";
  });
  const labels = await labelMemberships(
    ctx.admin,
    rows.map((row) => ({ id: row.id, member_id: null, account_id: row.account_id })),
  );
  return rows.map((row) => {
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    return {
      requestId: row.id,
      groupId: row.group_id,
      groupName: group?.name ?? "Group",
      name: labels.get(row.id)?.name ?? "Someone",
      avatarUrl: labels.get(row.id)?.avatarUrl ?? null,
      message: row.message,
      requestedAt: new Date(row.created_at).toISOString(),
    };
  });
}

export async function decideStaffRequests(
  ctx: StaffContext,
  groupId: string,
  input: { requestIds: string[]; decision: "approve" | "decline"; allowOverCapacity?: boolean },
): Promise<Record<DecideOutcome, number>> {
  const group = await loadStaffGroup(ctx, groupId);
  const tally: Record<DecideOutcome, number> = {
    approved: 0,
    declined: 0,
    already_decided: 0,
    full: 0,
    not_found: 0,
    requester_unavailable: 0,
    banned: 0,
  };
  for (const requestId of [...new Set(input.requestIds.filter(isUuid))].slice(0, 200)) {
    const outcome = await decideRequest(ctx.admin, {
      churchId: ctx.churchId,
      churchSlug: ctx.church.slug,
      groupId: group.id,
      requestId,
      decision: input.decision,
      actor: staffActor(ctx),
      allowOverCapacity: Boolean(input.allowOverCapacity),
    });
    tally[outcome] += 1;
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Invitation links
// ---------------------------------------------------------------------------

export async function listStaffInvitations(ctx: StaffContext, groupId: string) {
  const group = await loadStaffGroup(ctx, groupId);
  const { data } = await ctx.admin
    .from("group_invitations")
    .select("id, max_uses, used_count, expires_at, created_at")
    .eq("group_id", group.id)
    .eq("church_id", ctx.churchId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  // The link itself is shown once, when it is made: only its hash is stored.
  return ((data ?? []) as { id: string; max_uses: number; used_count: number; expires_at: string; created_at: string }[]).map((row) => ({
    id: row.id,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function createStaffInvitation(
  ctx: StaffContext,
  groupId: string,
  input: { maxUses?: number; expiresInDays?: number },
) {
  const group = await loadStaffGroup(ctx, groupId);
  if (group.status !== "active") throw new VisitorError("conflict", "Restore this group before inviting people.");
  return issueGroupInvitation(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    actor: staffActor(ctx),
    baseUrl: getCanonicalSiteUrl(),
    maxUses: input.maxUses,
    expiresInDays: input.expiresInDays,
  });
}

export async function revokeStaffInvitation(ctx: StaffContext, groupId: string, invitationId: string): Promise<void> {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(invitationId)) throw new VisitorError("group_not_found", "That link was not found.");
  const revoked = await revokeGroupInvitation(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    invitationId,
    actor: staffActor(ctx),
  });
  if (!revoked) throw new VisitorError("group_not_found", "That link was not found.");
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const AUDIT_LABELS: Record<string, string> = {
  group_created: "Created the group",
  settings_changed: "Changed settings",
  group_archived: "Archived the group",
  group_restored: "Restored the group",
  group_deleted: "Deleted the group",
  joined: "Joined",
  join_requested: "Asked to join",
  join_request_approved: "Approved a request to join",
  join_request_declined: "Declined a request to join",
  join_request_cancelled: "Withdrew a request to join",
  member_added: "Added a member",
  member_removed: "Removed a member",
  member_banned: "Removed and banned a member",
  ban_lifted: "Lifted a ban",
  role_changed: "Changed a role",
  left: "Left",
  left_church: "Left the church",
  invitation_created: "Created an invitation link",
  schedule_added: "Added a meeting schedule",
  schedule_changed: "Changed a meeting schedule",
  schedule_stopped: "Stopped a meeting schedule",
  event_created: "Added a gathering",
  event_updated: "Changed a gathering",
  event_cancelled: "Cancelled a gathering",
  attendance_recorded: "Took attendance",
  membership_linked: "Linked to People",
  membership_merged: "Merged duplicate memberships",
};

export async function listStaffGroupActivity(ctx: StaffContext, groupId: string, limit = 50) {
  const group = await loadStaffGroup(ctx, groupId, { includeDeleted: true });
  const { data } = await ctx.admin
    .from("group_audit_events")
    .select("id, action, actor_type, actor_user_id, subject_account_id, subject_member_id, created_at")
    .eq("group_id", group.id)
    .eq("church_id", ctx.churchId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  const rows = (data ?? []) as {
    id: string;
    action: string;
    actor_type: string;
    actor_user_id: string | null;
    subject_account_id: string | null;
    subject_member_id: string | null;
    created_at: string;
  }[];
  const subjects = await labelMemberships(
    ctx.admin,
    rows.map((row) => ({ id: row.id, member_id: row.subject_member_id, account_id: row.subject_account_id })),
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    label: AUDIT_LABELS[row.action] ?? row.action.replace(/_/g, " "),
    actorType: row.actor_type,
    subject: row.subject_account_id || row.subject_member_id ? subjects.get(row.id)?.name ?? null : null,
    at: new Date(row.created_at).toISOString(),
  }));
}
