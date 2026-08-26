import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import {
  buildInvitationPath,
  generateInvitationToken,
  hashInvitationToken,
  invitationExpiry,
} from "@/lib/faithful/invitation-token";
import { invitationSchema, pageSchema } from "@/lib/faithful/schemas";

/**
 * Staff-issued visitor invitations.
 *
 * Separate from `church_invites`, which onboards a church administrator.
 * Nothing here can produce a `church_users` row, so an invitation can never
 * hand out dashboard access however it is redeemed.
 */

export type IssuedInvitation = {
  id: string;
  /** Returned exactly once, at creation. Never stored and never re-readable. */
  url: string;
  purpose: "join" | "people_claim";
  expiresAt: string;
};

export async function issueInvitation(input: {
  churchId: string;
  staffUserId: string;
  payload: unknown;
  baseUrl: string;
}): Promise<IssuedInvitation> {
  const parsed = invitationSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }

  const admin = createAdminClient();

  // A people_claim invitation must name a person, and that person must belong
  // to the issuing church — this is the one place a member id is accepted, and
  // it is checked against the tenant rather than trusted.
  if (parsed.data.purpose === "people_claim") {
    if (!parsed.data.memberId) {
      throw new VisitorError("invalid_input", "Choose the person this is for.");
    }
    const { data: member } = await admin
      .from("members")
      .select("id")
      .eq("id", parsed.data.memberId)
      .eq("church_id", input.churchId)
      .maybeSingle();
    if (!member) {
      throw new VisitorError("invalid_input", "That person is not in this church.");
    }
  } else if (parsed.data.memberId) {
    throw new VisitorError(
      "invalid_input",
      "Only a person invitation may name a person.",
    );
  }

  const token = generateInvitationToken();
  const expiresAt = invitationExpiry(parsed.data.expiresInDays);

  const { data, error } = await admin
    .from("visitor_invitations")
    .insert({
      church_id: input.churchId,
      token_hash: hashInvitationToken(token),
      purpose: parsed.data.purpose,
      member_id: parsed.data.memberId ?? null,
      invited_email: parsed.data.invitedEmail ?? null,
      invited_label: parsed.data.invitedLabel ?? null,
      max_uses: parsed.data.maxUses,
      expires_at: expiresAt.toISOString(),
      created_by: input.staffUserId,
    })
    .select("id, purpose, expires_at")
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("unavailable", "Could not create that invitation.");
  }

  return {
    id: data.id as string,
    url: `${input.baseUrl.replace(/\/$/, "")}${buildInvitationPath(token)}`,
    purpose: data.purpose as IssuedInvitation["purpose"],
    expiresAt: data.expires_at as string,
  };
}

export type InvitationSummary = {
  id: string;
  purpose: "join" | "people_claim";
  invitedLabel: string | null;
  invitedEmail: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
};

/** Never returns `token_hash`. The list is for managing invitations, not replaying them. */
export async function listInvitations(
  churchId: string,
  input?: unknown,
): Promise<{ items: InvitationSummary[]; nextCursor: string | null }> {
  const parsed = pageSchema.safeParse(input ?? {});
  if (!parsed.success) throw new VisitorError("invalid_input", "Check your request.");
  const { limit, cursorId } = parsed.data;

  const admin = createAdminClient();
  let query = admin
    .from("visitor_invitations")
    .select(
      "id, purpose, invited_label, invited_email, max_uses, used_count, expires_at, revoked_at",
    )
    .eq("church_id", churchId)
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (cursorId) query = query.gt("id", cursorId);

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load invitations.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => ({
      id: row.id as string,
      purpose: row.purpose as InvitationSummary["purpose"],
      invitedLabel: (row.invited_label as string | null) ?? null,
      invitedEmail: (row.invited_email as string | null) ?? null,
      maxUses: Number(row.max_uses),
      usedCount: Number(row.used_count),
      expiresAt: row.expires_at as string,
      revokedAt: (row.revoked_at as string | null) ?? null,
    })),
    nextCursor: hasMore ? (page[page.length - 1].id as string) : null,
  };
}

export async function revokeInvitation(input: {
  churchId: string;
  staffUserId: string;
  invitationId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("visitor_invitations")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: input.staffUserId,
    })
    .eq("id", input.invitationId)
    // Exact tenant predicate: an id from another church matches nothing.
    .eq("church_id", input.churchId)
    .is("revoked_at", null);

  if (error) throw new VisitorError("unavailable", "Could not withdraw that invitation.");
}
