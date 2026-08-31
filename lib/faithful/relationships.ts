import type { SupabaseClient } from "@supabase/supabase-js";

import { isChurchFeatureEnabled } from "@/lib/features/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import {
  bumpAuthorizationVersion,
  ensureVisitorAccount,
  requireActiveAccount,
} from "@/lib/faithful/account";
import { hashInvitationToken } from "@/lib/faithful/invitation-token";
import { churchSlugSchema, pageSchema } from "@/lib/faithful/schemas";
import {
  decideTransition,
  type ActorType,
  type JoinPolicy,
  type RelationshipAction,
  type RelationshipState,
} from "@/lib/faithful/relationship-state";

export type Relationship = {
  id: string;
  accountId: string;
  churchId: string;
  state: RelationshipState;
  joinedAt: string | null;
  updatedAt: string;
};

const RELATIONSHIP_COLUMNS =
  "id, account_id, church_id, state, joined_at, updated_at";

function mapRelationship(row: Record<string, unknown>): Relationship {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    churchId: row.church_id as string,
    state: row.state as RelationshipState,
    joinedAt: (row.joined_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

type ChurchContext = { id: string; joinPolicy: JoinPolicy; isDiscoverable: boolean };

async function resolveChurchBySlug(
  admin: SupabaseClient,
  slug: string,
): Promise<ChurchContext> {
  const parsed = churchSlugSchema.safeParse(slug);
  if (!parsed.success) {
    throw new VisitorError("church_not_found", "Church not found.");
  }
  const { data } = await admin
    .from("churches")
    .select("id, join_policy, is_discoverable")
    .eq("slug", parsed.data)
    .maybeSingle();

  if (!data) throw new VisitorError("church_not_found", "Church not found.");

  return {
    id: data.id as string,
    joinPolicy: (data.join_policy as JoinPolicy) ?? "approval_required",
    isDiscoverable: Boolean(data.is_discoverable),
  };
}

async function loadRelationship(
  admin: SupabaseClient,
  accountId: string,
  churchId: string,
): Promise<Relationship | null> {
  const { data } = await admin
    .from("visitor_church_relationships")
    .select(RELATIONSHIP_COLUMNS)
    .eq("account_id", accountId)
    .eq("church_id", churchId)
    .maybeSingle();
  return data ? mapRelationship(data) : null;
}

async function recordEvent(
  admin: SupabaseClient,
  input: {
    relationshipId: string | null;
    accountId: string;
    churchId: string;
    fromState: RelationshipState | null;
    toState: RelationshipState;
    action: RelationshipAction;
    actorType: ActorType;
    actorUserId: string | null;
    reason?: string;
  },
): Promise<void> {
  await admin.from("visitor_relationship_events").insert({
    relationship_id: input.relationshipId,
    account_id: input.accountId,
    church_id: input.churchId,
    from_state: input.fromState,
    to_state: input.toState,
    action: input.action,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId,
    reason: input.reason ?? null,
  });
}

/**
 * The single write path for every relationship change.
 *
 * Follow, join, approve, block and invitation acceptance all land here, so the
 * state machine and the audit trail cannot be bypassed by adding a new caller.
 */
async function applyTransition(input: {
  accountId: string;
  church: ChurchContext;
  action: RelationshipAction;
  actorType: ActorType;
  actorUserId: string | null;
  hasValidInvitation?: boolean;
  invitationId?: string | null;
  reason?: string;
}): Promise<Relationship> {
  const admin = createAdminClient();
  const current = await loadRelationship(admin, input.accountId, input.church.id);

  const decision = decideTransition({
    action: input.action,
    from: current?.state ?? null,
    actorType: input.actorType,
    joinPolicy: input.church.joinPolicy,
    hasValidInvitation: input.hasValidInvitation,
  });

  if (!decision.ok) {
    throw new VisitorError(decision.code, decision.reason);
  }

  // A repeat of a command that already produced this state returns the current
  // row untouched, and writes no second audit event.
  if (decision.idempotent && current) return current;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    state: decision.to,
    updated_at: now,
    join_policy_at_request: input.church.joinPolicy,
  };
  if (decision.to === "pending") patch.requested_at = now;
  if (decision.to === "joined") patch.joined_at = now;
  if (decision.to === "left") patch.left_at = now;
  if (decision.to === "blocked") {
    patch.blocked_at = now;
    patch.blocked_by = input.actorUserId;
  }
  if (input.invitationId !== undefined) patch.invitation_id = input.invitationId;

  let relationship: Relationship;

  if (current) {
    const { data, error } = await admin
      .from("visitor_church_relationships")
      .update(patch)
      .eq("id", current.id)
      // Optimistic guard: if another request moved the row since it was read,
      // this update matches nothing rather than overwriting the newer state.
      .eq("state", current.state)
      .select(RELATIONSHIP_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      const latest = await loadRelationship(admin, input.accountId, input.church.id);
      if (latest && latest.state === decision.to) return latest;
      throw new VisitorError("conflict", "That request conflicted; try again.");
    }
    relationship = mapRelationship(data);
  } else {
    const { data, error } = await admin
      .from("visitor_church_relationships")
      .insert({
        account_id: input.accountId,
        church_id: input.church.id,
        ...patch,
      })
      .select(RELATIONSHIP_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      // The unique (account_id, church_id) index turned a concurrent first
      // follow into a conflict; the winner's row is the answer.
      const latest = await loadRelationship(admin, input.accountId, input.church.id);
      if (latest) return latest;
      throw new VisitorError("unavailable", "Could not save that.");
    }
    relationship = mapRelationship(data);
  }

  await recordEvent(admin, {
    relationshipId: relationship.id,
    accountId: input.accountId,
    churchId: input.church.id,
    fromState: current?.state ?? null,
    toState: decision.to,
    action: input.action,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });

  // Losing or gaining access must invalidate a device's cached decision.
  if (decision.to === "blocked" || decision.to === "left") {
    await bumpAuthorizationVersion(input.accountId, admin);
  }

  return relationship;
}


/**
 * A church whose Member App feature is switched off admits nobody new.
 *
 * Only the doors are guarded — following, joining, redeeming an invitation.
 * Leaving and unfollowing stay open on purpose: whatever we switch off, a
 * person must always be able to get themselves out.
 */
async function assertMemberAppEnabled(churchId: string): Promise<void> {
  if (await isChurchFeatureEnabled(churchId, "member_app")) return;
  throw new VisitorError("church_not_found", "Church not found.");
}

export async function followChurch(
  userId: string,
  churchSlug: string,
): Promise<Relationship> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const church = await resolveChurchBySlug(admin, churchSlug);

  // Following is only offered for a church that chose to be found.
  if (!church.isDiscoverable) {
    throw new VisitorError("church_not_found", "Church not found.");
  }
  await assertMemberAppEnabled(church.id);

  return applyTransition({
    accountId: account.id,
    church,
    action: "follow",
    actorType: "visitor",
    actorUserId: userId,
  });
}

export async function unfollowChurch(
  userId: string,
  churchSlug: string,
): Promise<Relationship> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const church = await resolveChurchBySlug(admin, churchSlug);
  return applyTransition({
    accountId: account.id,
    church,
    action: "unfollow",
    actorType: "visitor",
    actorUserId: userId,
  });
}

/**
 * Honours the church's policy: `open` joins immediately, `approval_required`
 * creates a pending request, `invite_only` refuses. The policy is read from
 * the church row, never from the request.
 */
export async function requestJoin(
  userId: string,
  churchSlug: string,
): Promise<Relationship> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const church = await resolveChurchBySlug(admin, churchSlug);

  if (!church.isDiscoverable) {
    throw new VisitorError("church_not_found", "Church not found.");
  }
  await assertMemberAppEnabled(church.id);

  return applyTransition({
    accountId: account.id,
    church,
    action: "request_join",
    actorType: "visitor",
    actorUserId: userId,
  });
}

export async function leaveChurch(
  userId: string,
  churchSlug: string,
): Promise<Relationship> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const church = await resolveChurchBySlug(admin, churchSlug);
  return applyTransition({
    accountId: account.id,
    church,
    action: "leave",
    actorType: "visitor",
    actorUserId: userId,
  });
}

/**
 * Redeems a join invitation. The token is hashed before it is used to look
 * anything up, and consumption is one atomic database call that also refuses a
 * blocked account — so replaying an old link cannot restore access.
 *
 * The account is ensured rather than required: by design the app posts a held
 * token immediately after authentication — before any bootstrap has run — and
 * for a brand-new signup that *is* the first authenticated use, the moment
 * Prompt 3 says the visitor row materializes. The lifecycle guard stays: a
 * deactivated or deletion-requested account may not redeem anything, and the
 * atomic consumer independently refuses a blocked one.
 */
export async function acceptJoinInvitation(
  userId: string,
  rawToken: string,
): Promise<Relationship> {
  const account = await ensureVisitorAccount(userId);
  if (account.status !== "active") {
    throw new VisitorError("account_inactive", "This account is not active.");
  }
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("consume_visitor_invitation", {
    p_token_hash: hashInvitationToken(rawToken),
    p_account_id: account.id,
    p_purpose: "join",
  });

  if (error) throw new VisitorError("unavailable", "Could not use that invitation.");

  const result = ((data ?? []) as Record<string, unknown>[])[0];
  if (!result?.ok) {
    throw invitationFailure((result?.reason as string) ?? "not_found");
  }

  const { data: church } = await admin
    .from("churches")
    .select("id, join_policy, is_discoverable")
    .eq("id", result.church_id as string)
    .maybeSingle();

  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  // The Member App switch outranks the invitation. This runs after the token
  // has been consumed, so refusing here spends it — which is the right way
  // round: a church with no app must not gain a member, and an invitation to
  // an app that no longer exists is not worth preserving.
  await assertMemberAppEnabled(church.id as string);

  // An invitation is its own authority: an invite_only or unlisted church is
  // exactly the case invitations exist for, so discoverability is not required.
  return applyTransition({
    accountId: account.id,
    church: {
      id: church.id as string,
      joinPolicy: (church.join_policy as JoinPolicy) ?? "approval_required",
      isDiscoverable: Boolean(church.is_discoverable),
    },
    action: "accept_invitation",
    actorType: "visitor",
    actorUserId: userId,
    hasValidInvitation: true,
    invitationId: result.invitation_id as string,
  });
}

export function invitationFailure(reason: string): VisitorError {
  switch (reason) {
    case "expired":
      return new VisitorError("invitation_expired", "That invitation has expired.");
    case "revoked":
      return new VisitorError("invitation_revoked", "That invitation was withdrawn.");
    case "exhausted":
      return new VisitorError(
        "invitation_exhausted",
        "That invitation has already been used.",
      );
    case "wrong_purpose":
      return new VisitorError(
        "invitation_wrong_purpose",
        "That invitation cannot be used here.",
      );
    case "blocked":
      return new VisitorError("blocked", "This account is blocked by the church.");
    default:
      return new VisitorError("invitation_invalid", "That invitation is not valid.");
  }
}

/** Staff-side. `churchId` is resolved from the caller's own session upstream. */
export async function staffRelationshipAction(input: {
  churchId: string;
  churchJoinPolicy: JoinPolicy;
  accountId: string;
  action: Extract<
    RelationshipAction,
    "approve" | "reject" | "block" | "unblock" | "revoke"
  >;
  staffUserId: string;
  reason?: string;
}): Promise<Relationship> {
  return applyTransition({
    accountId: input.accountId,
    church: {
      id: input.churchId,
      joinPolicy: input.churchJoinPolicy,
      isDiscoverable: true,
    },
    action: input.action,
    actorType: "staff",
    actorUserId: input.staffUserId,
    reason: input.reason,
  });
}

export type VisitorChurchSummary = {
  churchSlug: string;
  churchName: string;
  state: RelationshipState;
  updatedAt: string;
};

/** Every church this account has a relationship with. Bounded and cursor-stable. */
export async function listVisitorChurches(
  userId: string,
  input?: unknown,
): Promise<{ items: VisitorChurchSummary[]; nextCursor: string | null }> {
  const parsed = pageSchema.safeParse(input ?? {});
  if (!parsed.success) throw new VisitorError("invalid_input", "Check your request.");
  const { limit, cursorId } = parsed.data;

  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();

  let query = admin
    .from("visitor_church_relationships")
    .select("id, state, updated_at, churches!inner(slug, name)")
    .eq("account_id", account.id)
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (cursorId) query = query.gt("id", cursorId);

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load your churches.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => {
      const church = row.churches as { slug: string; name: string } | { slug: string; name: string }[];
      const resolved = Array.isArray(church) ? church[0] : church;
      return {
        churchSlug: resolved.slug,
        churchName: resolved.name,
        state: row.state as RelationshipState,
        updatedAt: row.updated_at as string,
      };
    }),
    nextCursor: hasMore ? (page[page.length - 1].id as string) : null,
  };
}

/**
 * Authorization for published content. Deliberately re-derived rather than
 * read from the account's selected church, which is only a preference.
 */
export async function getEffectiveRelationship(
  userId: string,
  churchSlug: string,
): Promise<Relationship | null> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const church = await resolveChurchBySlug(admin, churchSlug);
  return loadRelationship(admin, account.id, church.id);
}
