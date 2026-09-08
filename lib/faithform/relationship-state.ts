/**
 * The visitor↔church relationship state machine.
 *
 * Pure and self-contained so the rules can be tested without a database, and
 * so there is exactly one place that answers "is this transition legal".
 *
 * The states are deliberately not a hierarchy. `joined` is not "more" than
 * `following` in any way that grants dashboard access — both are visitor
 * relationships, and neither has anything to do with `church_users`.
 */
export const RELATIONSHIP_STATES = [
  "following",
  "pending",
  "joined",
  "left",
  "blocked",
] as const;

export type RelationshipState = (typeof RELATIONSHIP_STATES)[number];

export const RELATIONSHIP_ACTIONS = [
  "follow",
  "unfollow",
  "request_join",
  "accept_invitation",
  "approve",
  "reject",
  "leave",
  "block",
  "unblock",
  "revoke",
] as const;

export type RelationshipAction = (typeof RELATIONSHIP_ACTIONS)[number];

export type ActorType = "visitor" | "staff" | "system";

export const JOIN_POLICIES = ["open", "approval_required", "invite_only"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

/** Who is allowed to ask for each action. */
const ACTOR_RULES: Record<RelationshipAction, ActorType[]> = {
  follow: ["visitor"],
  unfollow: ["visitor"],
  request_join: ["visitor"],
  accept_invitation: ["visitor"],
  approve: ["staff"],
  reject: ["staff"],
  leave: ["visitor"],
  block: ["staff"],
  unblock: ["staff"],
  revoke: ["staff", "system"],
};

/**
 * `null` models "no relationship row yet" so the caller does not have to
 * special-case first contact.
 */
type From = RelationshipState | null;

const TRANSITIONS: Record<RelationshipAction, { from: From[]; to: RelationshipState }> = {
  follow: { from: [null, "left", "following"], to: "following" },
  unfollow: { from: ["following"], to: "left" },
  request_join: { from: [null, "following", "left", "pending"], to: "pending" },
  accept_invitation: { from: [null, "following", "left", "pending"], to: "joined" },
  approve: { from: ["pending"], to: "joined" },
  reject: { from: ["pending"], to: "left" },
  leave: { from: ["following", "pending", "joined"], to: "left" },
  block: { from: [null, "following", "pending", "joined", "left"], to: "blocked" },
  unblock: { from: ["blocked"], to: "left" },
  revoke: { from: ["joined", "pending", "following"], to: "left" },
};

export type TransitionRequest = {
  action: RelationshipAction;
  from: From;
  actorType: ActorType;
  joinPolicy: JoinPolicy;
  /** True only when a verified, unexpired invitation was consumed. */
  hasValidInvitation?: boolean;
};

export type TransitionDecision =
  | { ok: true; to: RelationshipState; idempotent: boolean }
  | { ok: false; code: "invalid_transition" | "forbidden" | "blocked"; reason: string };

/**
 * `blocked` is terminal for everyone except staff. This is checked before the
 * transition table so that no action — including replaying a previously valid
 * invitation — can route around it.
 */
export function decideTransition(request: TransitionRequest): TransitionDecision {
  const { action, from, actorType, joinPolicy, hasValidInvitation } = request;

  if (!ACTOR_RULES[action].includes(actorType)) {
    return {
      ok: false,
      code: "forbidden",
      reason: `${actorType} may not ${action}`,
    };
  }

  if (from === "blocked" && action !== "unblock" && action !== "block") {
    return {
      ok: false,
      code: "blocked",
      reason: "This account is blocked by the church.",
    };
  }

  const rule = TRANSITIONS[action];

  // Re-issuing a command that already produced the current state is a success,
  // not a conflict: a retried request over a flaky connection must not fail.
  if (from === rule.to && from !== null) {
    if (action === "follow" || action === "request_join" || action === "block") {
      return { ok: true, to: rule.to, idempotent: true };
    }
  }

  if (!rule.from.includes(from)) {
    return {
      ok: false,
      code: "invalid_transition",
      reason: `cannot ${action} from ${from ?? "no relationship"}`,
    };
  }

  if (action === "follow" && joinPolicy === "invite_only") {
    // Following is about receiving what a church publishes. An invite_only
    // church has not offered that to the public, so there is nothing to follow.
    return {
      ok: false,
      code: "forbidden",
      reason: "This church is invitation only.",
    };
  }

  if (action === "request_join") {
    if (joinPolicy === "open") {
      return { ok: true, to: "joined", idempotent: false };
    }
    if (joinPolicy === "invite_only") {
      return {
        ok: false,
        code: "forbidden",
        reason: "This church requires an invitation to join.",
      };
    }
  }

  if (action === "accept_invitation" && !hasValidInvitation) {
    return {
      ok: false,
      code: "forbidden",
      reason: "A valid invitation is required.",
    };
  }

  return { ok: true, to: rule.to, idempotent: false };
}

/** States that let a visitor read what a church publishes for followers. */
export function grantsPublishedContentAccess(state: RelationshipState): boolean {
  return state === "following" || state === "joined";
}

/**
 * Deliberately total and deliberately always false. A visitor relationship is
 * not a staff membership, and no state may ever imply one — the function
 * exists so that intent is stated in code rather than assumed.
 */
export function grantsDashboardAccess(_state: RelationshipState): boolean {
  return false;
}
