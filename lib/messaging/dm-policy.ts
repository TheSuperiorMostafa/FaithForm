/**
 * Who may hold a direct conversation with whom, under a church's policy.
 *
 * Pure, so every rule is tested exhaustively without a database, and so there
 * is exactly one answer to the question — the one the server applies before a
 * conversation is created, and again whenever a policy, a block, a restriction
 * or a group membership changes.
 *
 * The policies, in the words staff see:
 *
 *   disabled             Nobody. (The default.)
 *   leaders_only         Leaders and staff can start a conversation with people
 *                        in their groups. Members can reply, not start.
 *   leaders_and_members  Members can message their group leaders, and leaders
 *                        can message the members of their groups.
 *   group_members        Anyone can message someone they share a group with.
 *   everyone             Anyone in the church can message anyone.
 *
 * Staff (with the Groups feature) count as leaders of every group.
 *
 * Two rules sit above every policy:
 *
 *   * **Youth.** Anyone who is a member (not a leader) of a group marked as a
 *     youth context holds no direct conversations at all — group chat only.
 *     This is an explicit church setting, never an inference about age.
 *   * **Blocking.** Either person blocking the other ends it.
 */

export const DM_POLICIES = [
  "disabled",
  "leaders_only",
  "leaders_and_members",
  "group_members",
  "everyone",
] as const;

export type DmPolicy = (typeof DM_POLICIES)[number];

export type DmParty = {
  /** Church staff holding the Groups feature. */
  isStaff: boolean;
  /** Groups this person actively leads or manages. */
  ledGroupIds: readonly string[];
  /** Groups this person is an active member of, in any role. */
  memberGroupIds: readonly string[];
  /** A member (not a leader) of at least one youth group. */
  inYouthGroup: boolean;
  /** Has a usable relationship with the church and an active account. */
  eligible: boolean;
  /** Messaging suspended in this church. */
  restricted: boolean;
};

export type DmRefusal =
  | "messaging_off"
  | "policy_disabled"
  | "not_permitted"
  | "blocked"
  | "youth_protection"
  | "restricted"
  | "unavailable"
  | "self";

export type DmDecision = { allowed: true } | { allowed: false; reason: DmRefusal };

function leads(leader: DmParty, member: DmParty): boolean {
  if (leader.isStaff) return true;
  return leader.ledGroupIds.some((id) => member.memberGroupIds.includes(id));
}

function shareAGroup(a: DmParty, b: DmParty): boolean {
  return a.memberGroupIds.some((id) => b.memberGroupIds.includes(id));
}

export function decideDirectMessage(input: {
  policy: DmPolicy;
  messagingEnabled: boolean;
  initiator: DmParty;
  target: DmParty;
  sameUser?: boolean;
  /** Either person has blocked the other. */
  blocked: boolean;
  /**
   * `start`: may the initiator open a new conversation?
   * `continue`: may an existing conversation between them stay open? Symmetric
   * — under `leaders_only` a member may keep replying in a conversation a
   * leader started.
   */
  mode: "start" | "continue";
}): DmDecision {
  const { policy, initiator, target } = input;

  if (input.sameUser) return { allowed: false, reason: "self" };
  if (!input.messagingEnabled) return { allowed: false, reason: "messaging_off" };
  if (policy === "disabled") return { allowed: false, reason: "policy_disabled" };
  if (!initiator.eligible || !target.eligible) return { allowed: false, reason: "unavailable" };
  if (input.blocked) return { allowed: false, reason: "blocked" };
  if (initiator.inYouthGroup || target.inYouthGroup) return { allowed: false, reason: "youth_protection" };
  if (initiator.restricted || (input.mode === "continue" && target.restricted)) {
    return { allowed: false, reason: "restricted" };
  }

  const leaderPair = leads(initiator, target) || leads(target, initiator);
  let allowed: boolean;
  switch (policy) {
    case "everyone":
      allowed = true;
      break;
    case "group_members":
      allowed = leaderPair || shareAGroup(initiator, target);
      break;
    case "leaders_and_members":
      allowed = leaderPair;
      break;
    case "leaders_only":
      allowed = input.mode === "start" ? leads(initiator, target) : leaderPair;
      break;
    default:
      allowed = false;
  }

  return allowed ? { allowed: true } : { allowed: false, reason: "not_permitted" };
}

/** A sentence for the person who was refused. Never says who blocked whom. */
export function dmRefusalMessage(reason: DmRefusal): string {
  switch (reason) {
    case "messaging_off":
    case "policy_disabled":
      return "Direct messages are turned off at your church.";
    case "youth_protection":
      return "Direct messages aren't available for this person. You can still talk in your group.";
    case "restricted":
      return "Messaging is paused for this account.";
    case "self":
      return "You can't message yourself.";
    case "blocked":
    case "not_permitted":
    case "unavailable":
    default:
      return "You can't message this person.";
  }
}
