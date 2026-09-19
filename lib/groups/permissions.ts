import type {
  GroupEnrollment,
  GroupRole,
  GroupStatus,
  GroupVisibility,
  JoinAction,
  MembershipState,
} from "@/lib/groups/types";

/**
 * What someone may do in a group. Pure, so every rule is tested without a
 * database and exactly one place answers each question — the services call
 * these before any command, and the capabilities returned to a client are
 * these same answers (a client hides what it may not do; the server refuses
 * it regardless).
 *
 *   member   takes part: reads, chats, RSVPs.
 *   leader   shepherds: requests, members, gatherings, attendance, invitations,
 *            and moderating the conversation. Listed publicly as a leader.
 *   manager  everything a leader can, plus the group's settings and leader
 *            roles. Not listed as a leader.
 *   staff    church staff holding the Groups feature: everything, in every
 *            group of their church, including archive and delete.
 */

export type GroupActor =
  | { kind: "staff" }
  | { kind: "member"; role: GroupRole }
  | { kind: "outsider" };

export type GroupCapabilities = {
  canViewMembers: boolean;
  canManageMembers: boolean;
  canManageRequests: boolean;
  canInvite: boolean;
  canManageRoles: boolean;
  canEditDetails: boolean;
  canManageEvents: boolean;
  canTakeAttendance: boolean;
  canModerateChat: boolean;
  canArchive: boolean;
};

const NONE: GroupCapabilities = {
  canViewMembers: false,
  canManageMembers: false,
  canManageRequests: false,
  canInvite: false,
  canManageRoles: false,
  canEditDetails: false,
  canManageEvents: false,
  canTakeAttendance: false,
  canModerateChat: false,
  canArchive: false,
};

export function isLeaderRole(role: GroupRole): boolean {
  return role === "leader" || role === "manager";
}

export function capabilitiesFor(
  actor: GroupActor,
  group: { memberListVisibility: "members" | "leaders"; status: GroupStatus },
): GroupCapabilities {
  if (actor.kind === "staff") {
    const active = group.status === "active";
    return {
      canViewMembers: true,
      canManageMembers: active,
      canManageRequests: active,
      canInvite: active,
      canManageRoles: active,
      canEditDetails: true,
      canManageEvents: active,
      canTakeAttendance: true,
      canModerateChat: true,
      canArchive: true,
    };
  }
  if (actor.kind === "outsider") return { ...NONE };

  const leader = isLeaderRole(actor.role);
  const active = group.status === "active";
  return {
    canViewMembers: leader || group.memberListVisibility === "members",
    canManageMembers: leader && active,
    canManageRequests: leader && active,
    canInvite: leader && active,
    canManageRoles: actor.role === "manager" && active,
    canEditDetails: actor.role === "manager" && active,
    canManageEvents: leader && active,
    // Attendance for a past gathering stays recordable after archiving: the
    // gathering happened, and the record belongs to the church.
    canTakeAttendance: leader,
    canModerateChat: leader,
    canArchive: false,
  };
}

/**
 * Whether `actor` may remove someone holding `targetRole`. Nobody removes
 * themselves this way — that is leaving.
 */
export function canRemoveMember(actor: GroupActor, targetRole: GroupRole, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (actor.kind === "staff") return true;
  if (actor.kind !== "member") return false;
  if (actor.role === "manager") return targetRole !== "manager";
  if (actor.role === "leader") return targetRole === "member";
  return false;
}

/**
 * Whether `actor` may change someone from `from` to `to`. Nobody changes their
 * own role, and a manager cannot demote another manager (only staff can) — so
 * two managers can never lock each other out.
 */
export function canChangeRole(actor: GroupActor, from: GroupRole, to: GroupRole, isSelf: boolean): boolean {
  if (from === to) return false;
  if (actor.kind === "staff") return true;
  if (isSelf) return false;
  if (actor.kind !== "member" || actor.role !== "manager") return false;
  return from !== "manager";
}

/**
 * The one action a group page offers, for someone with this standing.
 * Mirrors `group_join`'s decision order exactly, so what the button says is
 * what the server will do.
 */
export function joinActionFor(input: {
  state: MembershipState;
  status: GroupStatus;
  visibility: GroupVisibility;
  enrollment: GroupEnrollment;
  capacity: number | null;
  memberCount: number;
}): JoinAction {
  if (input.state === "member") return "leave";
  if (input.state === "requested") return "cancel_request";
  if (input.status !== "active" || input.state === "banned") return "unavailable";
  if (input.visibility === "private") return "invitation_required";
  if (input.enrollment === "closed") return "closed";
  if (input.enrollment === "invitation_only") return "invitation_required";
  if (input.capacity !== null && input.memberCount >= input.capacity) return "full";
  return input.enrollment === "open" ? "join" : "request";
}
