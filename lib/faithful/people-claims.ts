import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { bumpAuthorizationVersion, requireActiveAccount } from "@/lib/faithful/account";
import { hashInvitationToken } from "@/lib/faithful/invitation-token";
import { invitationFailure } from "@/lib/faithful/relationships";
import {
  claimRequestSchema,
  claimResolutionSchema,
  normalizeEmail,
  normalizePhone,
  pageSchema,
  churchSlugSchema,
} from "@/lib/faithful/schemas";

/**
 * Account ↔ People claims and links.
 *
 * The invariant this module exists to protect: `members.id` is the only People
 * identity, and nothing here creates, merges or deletes a members row. A claim
 * is a request to be recognised; a link is a staff-verified answer.
 *
 * Email and phone appear only as text shown to authorized staff. There is no
 * code path — here or anywhere — that resolves a claim by matching them.
 */

export type ClaimStatus = "pending" | "approved" | "rejected" | "withdrawn" | "disputed";

export type VisitorClaimView = {
  status: ClaimStatus;
  source: "self_request" | "invitation";
  createdAt: string;
  resolvedAt: string | null;
  isLinked: boolean;
};

async function resolveChurchIdBySlug(
  admin: SupabaseClient,
  slug: string,
): Promise<string> {
  const parsed = churchSlugSchema.safeParse(slug);
  if (!parsed.success) throw new VisitorError("church_not_found", "Church not found.");
  const { data } = await admin
    .from("churches")
    .select("id")
    .eq("slug", parsed.data)
    .maybeSingle();
  if (!data) throw new VisitorError("church_not_found", "Church not found.");
  return data.id as string;
}

async function assertNotBlocked(
  admin: SupabaseClient,
  accountId: string,
  churchId: string,
): Promise<void> {
  const { data } = await admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", accountId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (data?.state === "blocked") {
    throw new VisitorError("blocked", "This account is blocked by the church.");
  }
}

/**
 * Opens a claim. Nothing is linked here — the row lands in the church's queue
 * with the claimant's own description of themselves and waits for a human.
 */
export async function requestPeopleClaim(
  userId: string,
  input: unknown,
): Promise<VisitorClaimView> {
  const parsed = claimRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }

  // Prompt 3 is self-managed accounts only. A claim naming someone else is
  // refused outright rather than quietly reinterpreted as a self-claim.
  if (parsed.data.onBehalfOfMemberId) {
    throw new VisitorError(
      "unsupported_dependent_claim",
      "Claiming on behalf of another person is not supported yet.",
    );
  }

  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const churchId = await resolveChurchIdBySlug(admin, parsed.data.churchSlug);
  await assertNotBlocked(admin, account.id, churchId);

  const { data: existingLink } = await admin
    .from("visitor_people_links")
    .select("id")
    .eq("account_id", account.id)
    .eq("church_id", churchId)
    .eq("is_active", true)
    .maybeSingle();

  if (existingLink) {
    throw new VisitorError("already_linked", "This account is already linked.");
  }

  const { data: open } = await admin
    .from("visitor_people_claims")
    .select("id, status, source, created_at, resolved_at")
    .eq("account_id", account.id)
    .eq("church_id", churchId)
    .in("status", ["pending", "disputed"])
    .maybeSingle();

  // Re-submitting refreshes the details staff will see rather than queueing a
  // duplicate for them to reconcile.
  if (open) {
    await admin
      .from("visitor_people_claims")
      .update({
        claimed_first_name: parsed.data.firstName ?? null,
        claimed_last_name: parsed.data.lastName ?? null,
        normalized_email: normalizeEmail(parsed.data.email),
        normalized_phone: normalizePhone(parsed.data.phone),
        updated_at: new Date().toISOString(),
      })
      .eq("id", open.id);

    return {
      status: open.status as ClaimStatus,
      source: open.source as VisitorClaimView["source"],
      createdAt: open.created_at as string,
      resolvedAt: (open.resolved_at as string | null) ?? null,
      isLinked: false,
    };
  }

  const { data, error } = await admin
    .from("visitor_people_claims")
    .insert({
      account_id: account.id,
      church_id: churchId,
      status: "pending",
      source: "self_request",
      claimed_first_name: parsed.data.firstName ?? null,
      claimed_last_name: parsed.data.lastName ?? null,
      normalized_email: normalizeEmail(parsed.data.email),
      normalized_phone: normalizePhone(parsed.data.phone),
    })
    .select("id, status, source, created_at, resolved_at")
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("unavailable", "Could not submit your request.");
  }

  await admin.from("visitor_people_link_events").insert({
    church_id: churchId,
    account_id: account.id,
    claim_id: data.id as string,
    action: "claim_opened",
    to_status: "pending",
    actor_type: "visitor",
    actor_user_id: userId,
  });

  return {
    status: data.status as ClaimStatus,
    source: data.source as VisitorClaimView["source"],
    createdAt: data.created_at as string,
    resolvedAt: null,
    isLinked: false,
  };
}

/**
 * Redeems a `people_claim` invitation issued for a specific person.
 *
 * Even here the link is not automatic in the sense that matters: the token is
 * proof that staff chose this person deliberately, and the account must still
 * authenticate, the church must still match, the token must still be unused
 * and unexpired, and the target must not already be claimed by someone else.
 */
export async function acceptPeopleClaimInvitation(
  userId: string,
  rawToken: string,
): Promise<VisitorClaimView> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("consume_visitor_invitation", {
    p_token_hash: hashInvitationToken(rawToken),
    p_account_id: account.id,
    p_purpose: "people_claim",
  });

  if (error) throw new VisitorError("unavailable", "Could not use that invitation.");

  const result = ((data ?? []) as Record<string, unknown>[])[0];
  if (!result?.ok) throw invitationFailure((result?.reason as string) ?? "not_found");

  const churchId = result.church_id as string;
  const memberId = (result.member_id as string | null) ?? null;

  if (!memberId) {
    throw new VisitorError(
      "invitation_invalid",
      "That invitation is not linked to a person.",
    );
  }

  const { data: taken } = await admin
    .from("visitor_people_links")
    .select("id, account_id")
    .eq("member_id", memberId)
    .eq("is_active", true)
    .maybeSingle();

  if (taken && taken.account_id !== account.id) {
    // Someone else already holds this person. That is a dispute for staff, not
    // a silent takeover.
    const claim = await openDisputedClaim(admin, {
      accountId: account.id,
      churchId,
      memberId,
      invitationId: result.invitation_id as string,
      userId,
    });
    return claim;
  }

  const { data: claim, error: claimError } = await admin
    .from("visitor_people_claims")
    .insert({
      account_id: account.id,
      church_id: churchId,
      status: "pending",
      source: "invitation",
      invitation_id: result.invitation_id as string,
      requested_member_id: memberId,
    })
    .select("id, status, source, created_at, resolved_at")
    .maybeSingle();

  if (claimError || !claim) {
    throw new VisitorError("unavailable", "Could not record your request.");
  }

  await admin.from("visitor_people_link_events").insert({
    church_id: churchId,
    account_id: account.id,
    claim_id: claim.id as string,
    member_id: memberId,
    action: "claim_opened_from_invitation",
    to_status: "pending",
    actor_type: "visitor",
    actor_user_id: userId,
  });

  return {
    status: claim.status as ClaimStatus,
    source: "invitation",
    createdAt: claim.created_at as string,
    resolvedAt: null,
    isLinked: false,
  };
}

async function openDisputedClaim(
  admin: SupabaseClient,
  input: {
    accountId: string;
    churchId: string;
    memberId: string;
    invitationId: string;
    userId: string;
  },
): Promise<VisitorClaimView> {
  const { data } = await admin
    .from("visitor_people_claims")
    .insert({
      account_id: input.accountId,
      church_id: input.churchId,
      status: "disputed",
      source: "invitation",
      invitation_id: input.invitationId,
      requested_member_id: input.memberId,
    })
    .select("id, status, source, created_at, resolved_at")
    .maybeSingle();

  await admin.from("visitor_people_link_events").insert({
    church_id: input.churchId,
    account_id: input.accountId,
    claim_id: (data?.id as string) ?? null,
    member_id: input.memberId,
    action: "claim_disputed_already_linked",
    to_status: "disputed",
    actor_type: "system",
    note: "Another account already holds an active link to this person.",
  });

  return {
    status: "disputed",
    source: "invitation",
    createdAt: (data?.created_at as string) ?? new Date().toISOString(),
    resolvedAt: null,
    isLinked: false,
  };
}

/** What the claimant may see: their own status, never a People identifier. */
export async function getClaimStatus(
  userId: string,
  churchSlug: string,
): Promise<VisitorClaimView | null> {
  const account = await requireActiveAccount(userId);
  const admin = createAdminClient();
  const churchId = await resolveChurchIdBySlug(admin, churchSlug);

  const { data } = await admin
    .from("visitor_people_claims")
    .select("status, source, created_at, resolved_at")
    .eq("account_id", account.id)
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const { data: link } = await admin
    .from("visitor_people_links")
    .select("id")
    .eq("account_id", account.id)
    .eq("church_id", churchId)
    .eq("is_active", true)
    .maybeSingle();

  return {
    status: data.status as ClaimStatus,
    source: data.source as VisitorClaimView["source"],
    createdAt: data.created_at as string,
    resolvedAt: (data.resolved_at as string | null) ?? null,
    isLinked: Boolean(link),
  };
}

// ---------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------

export type StaffClaimRow = {
  id: string;
  status: ClaimStatus;
  source: "self_request" | "invitation";
  claimedName: string | null;
  claimedEmail: string | null;
  claimedPhone: string | null;
  requestedMemberId: string | null;
  createdAt: string;
  candidates: ClaimCandidate[];
};

export type ClaimCandidate = {
  memberId: string;
  firstName: string;
  lastName: string;
  /** Why this person is being suggested, so staff can judge rather than trust. */
  matchedOn: ("email" | "phone" | "name")[];
  alreadyLinked: boolean;
};

/**
 * Candidate suggestions for a human to choose from.
 *
 * This is the closest the system comes to matching, and it is deliberately
 * advisory: the results are shown to authorized staff of that church only, are
 * never returned to the claimant, and never cause a write. A church with two
 * members sharing a phone number gets two candidates and a decision to make.
 */
export async function listPendingClaims(
  churchId: string,
  input?: unknown,
): Promise<{ items: StaffClaimRow[]; nextCursor: string | null }> {
  const parsed = pageSchema.safeParse(input ?? {});
  if (!parsed.success) throw new VisitorError("invalid_input", "Check your request.");
  const { limit, cursorId } = parsed.data;

  const admin = createAdminClient();

  let query = admin
    .from("visitor_people_claims")
    .select(
      "id, status, source, claimed_first_name, claimed_last_name, normalized_email, normalized_phone, requested_member_id, created_at",
    )
    .eq("church_id", churchId)
    .in("status", ["pending", "disputed"])
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (cursorId) query = query.gt("id", cursorId);

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load requests.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items: StaffClaimRow[] = [];
  for (const row of page) {
    items.push({
      id: row.id as string,
      status: row.status as ClaimStatus,
      source: row.source as StaffClaimRow["source"],
      claimedName:
        [row.claimed_first_name, row.claimed_last_name]
          .filter(Boolean)
          .join(" ")
          .trim() || null,
      claimedEmail: (row.normalized_email as string | null) ?? null,
      claimedPhone: (row.normalized_phone as string | null) ?? null,
      requestedMemberId: (row.requested_member_id as string | null) ?? null,
      createdAt: row.created_at as string,
      candidates: await findCandidates(admin, churchId, {
        email: row.normalized_email as string | null,
        phone: row.normalized_phone as string | null,
        firstName: row.claimed_first_name as string | null,
        lastName: row.claimed_last_name as string | null,
        requestedMemberId: row.requested_member_id as string | null,
      }),
    });
  }

  return {
    items,
    nextCursor: hasMore ? (page[page.length - 1].id as string) : null,
  };
}

async function findCandidates(
  admin: SupabaseClient,
  churchId: string,
  hints: {
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
    requestedMemberId: string | null;
  },
): Promise<ClaimCandidate[]> {
  const byId = new Map<string, ClaimCandidate>();

  const add = (
    row: { id: string; first_name: string; last_name: string },
    reason: "email" | "phone" | "name",
  ) => {
    const existing = byId.get(row.id);
    if (existing) {
      if (!existing.matchedOn.includes(reason)) existing.matchedOn.push(reason);
      return;
    }
    byId.set(row.id, {
      memberId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      matchedOn: [reason],
      alreadyLinked: false,
    });
  };

  const columns = "id, first_name, last_name";

  // A staff-issued invitation names its target explicitly; show it first and
  // do not dilute it with guesses.
  if (hints.requestedMemberId) {
    const { data } = await admin
      .from("members")
      .select(columns)
      .eq("church_id", churchId)
      .eq("id", hints.requestedMemberId)
      .maybeSingle();
    if (data) add(data as never, "name");
  }

  if (hints.email) {
    const { data } = await admin
      .from("members")
      .select(columns)
      .eq("church_id", churchId)
      .eq("email", hints.email)
      .limit(10);
    for (const row of data ?? []) add(row as never, "email");
  }

  if (hints.phone) {
    const { data } = await admin
      .from("members")
      .select(columns)
      .eq("church_id", churchId)
      .eq("phone", hints.phone)
      .limit(10);
    for (const row of data ?? []) add(row as never, "phone");
  }

  if (hints.firstName && hints.lastName) {
    const { data } = await admin
      .from("members")
      .select(columns)
      .eq("church_id", churchId)
      .ilike("first_name", hints.firstName)
      .ilike("last_name", hints.lastName)
      .limit(10);
    for (const row of data ?? []) add(row as never, "name");
  }

  const candidates = Array.from(byId.values());
  if (candidates.length === 0) return candidates;

  const { data: links } = await admin
    .from("visitor_people_links")
    .select("member_id")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .in(
      "member_id",
      candidates.map((c) => c.memberId),
    );

  const linked = new Set((links ?? []).map((l) => l.member_id as string));
  for (const candidate of candidates) {
    candidate.alreadyLinked = linked.has(candidate.memberId);
  }

  return candidates;
}

/**
 * Approving is the only path that creates a link, and it always names the
 * People record explicitly. The partial unique indexes make a double-approval
 * a database error rather than a second live link.
 */
export async function approveClaim(input: {
  churchId: string;
  staffUserId: string;
  claimId: string;
  memberId: string;
  note?: string;
}): Promise<void> {
  const parsed = claimResolutionSchema.safeParse({
    claimId: input.claimId,
    memberId: input.memberId,
    note: input.note,
  });
  if (!parsed.success || !parsed.data.memberId) {
    throw new VisitorError("invalid_input", "Choose the person to link.");
  }

  const admin = createAdminClient();

  // Exact church predicate on both sides: a claim id from another tenant
  // matches nothing.
  const { data: claim } = await admin
    .from("visitor_people_claims")
    .select("id, account_id, church_id, status")
    .eq("id", parsed.data.claimId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!claim) throw new VisitorError("claim_not_found", "Request not found.");
  if (!["pending", "disputed"].includes(claim.status as string)) {
    throw new VisitorError("conflict", "That request was already resolved.");
  }

  const { data: member } = await admin
    .from("members")
    .select("id")
    .eq("id", parsed.data.memberId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!member) throw new VisitorError("invalid_input", "That person is not in this church.");

  const { data: taken } = await admin
    .from("visitor_people_links")
    .select("id, account_id")
    .eq("member_id", parsed.data.memberId)
    .eq("is_active", true)
    .maybeSingle();

  if (taken && taken.account_id !== claim.account_id) {
    throw new VisitorError(
      "member_already_claimed",
      "Another account is already linked to that person.",
    );
  }

  const now = new Date().toISOString();

  const { data: link, error: linkError } = await admin
    .from("visitor_people_links")
    .insert({
      account_id: claim.account_id as string,
      church_id: input.churchId,
      member_id: parsed.data.memberId,
      claim_id: claim.id as string,
      is_active: true,
      linked_at: now,
      linked_by: input.staffUserId,
    })
    .select("id")
    .maybeSingle();

  if (linkError || !link) {
    throw new VisitorError(
      "member_already_claimed",
      "That person already has an active link.",
    );
  }

  await admin
    .from("visitor_people_claims")
    .update({
      status: "approved",
      resolved_member_id: parsed.data.memberId,
      resolved_by: input.staffUserId,
      resolved_at: now,
      resolution_note: parsed.data.note ?? null,
      updated_at: now,
    })
    .eq("id", claim.id as string);

  await admin.from("visitor_people_link_events").insert({
    church_id: input.churchId,
    account_id: claim.account_id as string,
    claim_id: claim.id as string,
    link_id: link.id as string,
    member_id: parsed.data.memberId,
    action: "claim_approved",
    from_status: claim.status as string,
    to_status: "approved",
    actor_type: "staff",
    actor_user_id: input.staffUserId,
    note: parsed.data.note ?? null,
  });

  await bumpAuthorizationVersion(claim.account_id as string, admin);
}

export async function rejectClaim(input: {
  churchId: string;
  staffUserId: string;
  claimId: string;
  note?: string;
  dispute?: boolean;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: claim } = await admin
    .from("visitor_people_claims")
    .select("id, account_id, status")
    .eq("id", input.claimId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!claim) throw new VisitorError("claim_not_found", "Request not found.");

  const next = input.dispute ? "disputed" : "rejected";
  const now = new Date().toISOString();

  await admin
    .from("visitor_people_claims")
    .update({
      status: next,
      resolved_by: input.dispute ? null : input.staffUserId,
      resolved_at: input.dispute ? null : now,
      resolution_note: input.note ?? null,
      updated_at: now,
    })
    .eq("id", claim.id as string)
    .eq("church_id", input.churchId);

  await admin.from("visitor_people_link_events").insert({
    church_id: input.churchId,
    account_id: claim.account_id as string,
    claim_id: claim.id as string,
    action: input.dispute ? "claim_disputed" : "claim_rejected",
    from_status: claim.status as string,
    to_status: next,
    actor_type: "staff",
    actor_user_id: input.staffUserId,
    note: input.note ?? null,
  });
}

/**
 * Revoking deactivates the link and leaves the members row untouched. The
 * person still exists, their attendance history still points at them; only the
 * account's claim to be them is withdrawn.
 */
export async function revokeLink(input: {
  churchId: string;
  staffUserId: string;
  linkId: string;
  reason?: string;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: link } = await admin
    .from("visitor_people_links")
    .select("id, account_id, member_id, is_active")
    .eq("id", input.linkId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!link) throw new VisitorError("claim_not_found", "Link not found.");
  if (!link.is_active) return;

  const now = new Date().toISOString();

  await admin
    .from("visitor_people_links")
    .update({
      is_active: false,
      revoked_at: now,
      revoked_by: input.staffUserId,
      revoke_reason: input.reason ?? null,
      updated_at: now,
    })
    .eq("id", link.id as string)
    .eq("church_id", input.churchId)
    .eq("is_active", true);

  await admin.from("visitor_people_link_events").insert({
    church_id: input.churchId,
    account_id: link.account_id as string,
    link_id: link.id as string,
    member_id: link.member_id as string,
    action: "link_revoked",
    from_status: "active",
    to_status: "revoked",
    actor_type: "staff",
    actor_user_id: input.staffUserId,
    note: input.reason ?? null,
  });

  await bumpAuthorizationVersion(link.account_id as string, admin);
}

export async function listLinkAudit(
  churchId: string,
  memberId?: string,
  limit = 50,
): Promise<
  { action: string; createdAt: string; note: string | null; actorType: string }[]
> {
  const admin = createAdminClient();
  let query = admin
    .from("visitor_people_link_events")
    .select("action, created_at, note, actor_type")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));

  if (memberId) query = query.eq("member_id", memberId);

  const { data } = await query;
  return (data ?? []).map((row) => ({
    action: row.action as string,
    createdAt: row.created_at as string,
    note: (row.note as string | null) ?? null,
    actorType: row.actor_type as string,
  }));
}
