import type { SupabaseClient } from "@supabase/supabase-js";

import { VisitorError } from "@/lib/faithform/errors";
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
} from "@/lib/faithform/invitation-token";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";
import { notifyLeadersOfJoinRequest, notifyRequestApproved } from "@/lib/groups/notifications";
import type { GroupRole } from "@/lib/groups/types";

/**
 * Who belongs to a group, changed. Every function here is one call to the
 * migration's atomic command (which locks the group row and checks the
 * tenant), followed by what the change should set in motion: a notification,
 * and an immediate attempt to bring the conversation in line — which the
 * outbox guarantees happens eventually even if this attempt cannot.
 *
 * Authorization of the actor happens before these are called, in the member
 * and staff services, through `lib/groups/permissions.ts`.
 */

export type Actor = { type: "staff" | "leader" | "member"; userId: string };

export type JoinOutcome =
  | "joined"
  | "already_member"
  | "requested"
  | "already_requested"
  | "full"
  | "closed"
  | "invitation_required"
  | "invitation_invalid"
  | "banned"
  | "not_found";

async function reconcileGroup(groupId: string): Promise<void> {
  await syncNow([dedupeKey("group.members", groupId), dedupeKey("group.channel", groupId)]);
}

export async function joinGroup(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string;
    groupId: string;
    groupName: string;
    accountId: string;
    requesterName: string | null;
    message?: string | null;
    invitationTokenHash?: string | null;
  },
): Promise<JoinOutcome> {
  const { data, error } = await admin.rpc("group_join", {
    p_group_id: input.groupId,
    p_account_id: input.accountId,
    p_message: input.message ?? null,
    p_invitation_token_hash: input.invitationTokenHash ?? null,
  });
  if (error) throw new VisitorError("unavailable", "Could not join that group right now.");
  const row = ((data ?? []) as { outcome: JoinOutcome; request_id: string | null }[])[0];
  const outcome = row?.outcome ?? "not_found";

  if (outcome === "joined") await reconcileGroup(input.groupId);
  if (outcome === "requested" && row?.request_id) {
    await notifyLeadersOfJoinRequest(admin, {
      churchId: input.churchId,
      churchSlug: input.churchSlug,
      groupId: input.groupId,
      groupName: input.groupName,
      requestId: row.request_id,
      requesterName: input.requesterName,
    });
  }
  return outcome;
}

export async function leaveGroup(
  admin: SupabaseClient,
  groupId: string,
  accountId: string,
): Promise<"left" | "request_cancelled" | "not_member"> {
  const { data, error } = await admin.rpc("group_leave", { p_group_id: groupId, p_account_id: accountId });
  if (error) throw new VisitorError("unavailable", "Could not leave that group right now.");
  const outcome = (data as "left" | "request_cancelled" | "not_member") ?? "not_member";
  if (outcome === "left") await reconcileGroup(groupId);
  return outcome;
}

export type DecideOutcome =
  | "approved"
  | "declined"
  | "already_decided"
  | "full"
  | "not_found"
  | "requester_unavailable"
  | "banned";

export async function decideRequest(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string | null;
    groupId: string;
    requestId: string;
    decision: "approve" | "decline";
    actor: Actor;
    allowOverCapacity?: boolean;
  },
): Promise<DecideOutcome> {
  const { data, error } = await admin.rpc("group_decide_request", {
    p_request_id: input.requestId,
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_decision: input.decision,
    p_actor_user_id: input.actor.userId,
    p_actor_type: input.actor.type === "staff" ? "staff" : "leader",
    p_allow_over_capacity: Boolean(input.allowOverCapacity),
  });
  if (error) throw new VisitorError("unavailable", "Could not update that request right now.");
  const outcome = (((data ?? []) as { outcome: DecideOutcome }[])[0]?.outcome ?? "not_found") as DecideOutcome;

  if (outcome === "approved") {
    const { data: request } = await admin
      .from("group_join_requests")
      .select("group_id, account_id, groups!inner(name)")
      .eq("id", input.requestId)
      .eq("church_id", input.churchId)
      .maybeSingle();
    if (request) {
      const group = (request as { groups: { name: string } | { name: string }[] }).groups;
      const groupName = (Array.isArray(group) ? group[0]?.name : group?.name) ?? "Your group";
      await reconcileGroup(request.group_id as string);
      if (input.churchSlug) {
        await notifyRequestApproved(admin, {
          churchId: input.churchId,
          churchSlug: input.churchSlug,
          groupId: request.group_id as string,
          groupName,
          requestId: input.requestId,
          accountId: request.account_id as string,
        });
      }
    }
  }
  return outcome;
}

export async function addPeopleToGroup(
  admin: SupabaseClient,
  input: {
    churchId: string;
    groupId: string;
    memberIds: string[];
    groupRole: GroupRole;
    actor: Actor;
    allowOverCapacity?: boolean;
  },
): Promise<{ added: number; alreadyMembers: number; refused: number }> {
  const tally = { added: 0, alreadyMembers: 0, refused: 0 };
  for (const memberId of [...new Set(input.memberIds)].slice(0, 200)) {
    const { data, error } = await admin.rpc("group_add_member", {
      p_group_id: input.groupId,
      p_church_id: input.churchId,
      p_member_id: memberId,
      p_account_id: null,
      p_group_role: input.groupRole,
      p_actor_user_id: input.actor.userId,
      p_actor_type: input.actor.type === "staff" ? "staff" : "leader",
      p_allow_over_capacity: Boolean(input.allowOverCapacity),
    });
    if (error) throw new VisitorError("unavailable", "Could not add everyone right now.");
    const outcome = ((data ?? []) as { outcome: string }[])[0]?.outcome;
    if (outcome === "added") tally.added += 1;
    else if (outcome === "already_member") tally.alreadyMembers += 1;
    else tally.refused += 1;
  }
  if (tally.added > 0) await reconcileGroup(input.groupId);
  return tally;
}

export async function removeFromGroup(
  admin: SupabaseClient,
  input: { churchId: string; groupId: string; membershipId: string; ban: boolean; reason: string | null; actor: Actor },
): Promise<"removed" | "banned" | "not_found"> {
  const { data, error } = await admin.rpc("group_remove_member", {
    p_membership_id: input.membershipId,
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_ban: input.ban,
    p_reason: input.reason,
    p_actor_user_id: input.actor.userId,
    p_actor_type: input.actor.type === "staff" ? "staff" : "leader",
  });
  if (error) throw new VisitorError("unavailable", "Could not remove them right now.");
  const outcome = (data as "removed" | "banned" | "not_found") ?? "not_found";
  if (outcome !== "not_found") await reconcileGroup(input.groupId);
  return outcome;
}

export async function setGroupRole(
  admin: SupabaseClient,
  input: { churchId: string; groupId: string; membershipId: string; groupRole: GroupRole; actor: Actor },
): Promise<"updated" | "unchanged" | "not_found"> {
  const { data, error } = await admin.rpc("group_set_role", {
    p_membership_id: input.membershipId,
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_group_role: input.groupRole,
    p_actor_user_id: input.actor.userId,
    p_actor_type: input.actor.type === "staff" ? "staff" : "leader",
  });
  if (error) throw new VisitorError("unavailable", "Could not change that role right now.");
  const outcome = (data as "updated" | "unchanged" | "not_found") ?? "not_found";
  if (outcome === "updated") await reconcileGroup(input.groupId);
  return outcome;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type IssuedGroupInvitation = { id: string; url: string; expiresAt: string; maxUses: number };

/** `/g/<token>`: a page that opens the app, or explains how to get it. */
export function buildGroupInvitationPath(token: string): string {
  return `/g/${encodeURIComponent(token)}`;
}

export async function issueGroupInvitation(
  admin: SupabaseClient,
  input: {
    churchId: string;
    groupId: string;
    actor: Actor;
    baseUrl: string;
    maxUses?: number;
    expiresInDays?: number;
  },
): Promise<IssuedGroupInvitation> {
  const token = generateInvitationToken();
  const maxUses = Math.min(Math.max(input.maxUses ?? 50, 1), 1000);
  const expiresAt = invitationExpiry(Math.min(Math.max(input.expiresInDays ?? 14, 1), 90));
  const { data, error } = await admin
    .from("group_invitations")
    .insert({
      church_id: input.churchId,
      group_id: input.groupId,
      token_hash: hashInvitationToken(token),
      max_uses: maxUses,
      expires_at: expiresAt.toISOString(),
      created_by: input.actor.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new VisitorError("unavailable", "Could not create an invitation link.");

  await admin.rpc("log_group_event", {
    p_church_id: input.churchId,
    p_group_id: input.groupId,
    p_action: "invitation_created",
    p_actor_type: input.actor.type === "staff" ? "staff" : "leader",
    p_actor_user_id: input.actor.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: { maxUses, expiresAt: expiresAt.toISOString() },
  });

  return {
    id: data.id as string,
    url: `${input.baseUrl.replace(/\/$/, "")}${buildGroupInvitationPath(token)}`,
    expiresAt: expiresAt.toISOString(),
    maxUses,
  };
}

export async function revokeGroupInvitation(
  admin: SupabaseClient,
  input: { churchId: string; groupId: string; invitationId: string; actor: Actor },
): Promise<boolean> {
  const { data } = await admin
    .from("group_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by: input.actor.userId })
    .eq("id", input.invitationId)
    .eq("group_id", input.groupId)
    .eq("church_id", input.churchId)
    .is("revoked_at", null)
    .select("id");
  return (data ?? []).length > 0;
}

/**
 * What a link says before anyone signs in: the group and its church, nothing
 * that a stranger holding a forwarded link could mine. A link that is spent,
 * expired, revoked or unknown previews as nothing at all.
 */
export async function previewGroupInvitation(
  admin: SupabaseClient,
  rawToken: string,
): Promise<{ groupId: string; groupName: string; coverImageUrl: string | null; churchSlug: string; churchName: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(rawToken)) return null;
  const { data } = await admin
    .from("group_invitations")
    .select("group_id, expires_at, revoked_at, used_count, max_uses, groups!inner(name, cover_image_url, status), churches!inner(slug, name)")
    .eq("token_hash", hashInvitationToken(rawToken))
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    group_id: string;
    expires_at: string;
    revoked_at: string | null;
    used_count: number;
    max_uses: number;
    groups: { name: string; cover_image_url: string | null; status: string };
    churches: { slug: string | null; name: string };
  };
  const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
  const church = Array.isArray(row.churches) ? row.churches[0] : row.churches;
  if (
    row.revoked_at ||
    Date.parse(row.expires_at) <= Date.now() ||
    row.used_count >= row.max_uses ||
    group?.status !== "active" ||
    !church?.slug
  ) {
    return null;
  }
  return {
    groupId: row.group_id,
    groupName: group.name,
    coverImageUrl: group.cover_image_url,
    churchSlug: church.slug,
    churchName: church.name,
  };
}
