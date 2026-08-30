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

export type InvitationPreview = {
  churchSlug: string;
  churchName: string;
  logoUrl: string | null;
};

/**
 * The church behind an invitation, without spending it.
 *
 * Exists so the signed-out account screens can say "Join Grace Community" over
 * the right logo instead of a generic welcome. That is the whole reason this is
 * readable without a session: the person has not signed in yet, which is
 * precisely the moment the church needs naming.
 *
 * ## Why this is safe to expose
 *
 * The token is 256 bits of CSPRNG output, so possession is the authorization
 * and there is nothing to enumerate. Only three fields come back — slug, name,
 * logo — the same three a discoverable church already publishes. Address,
 * contact details and join policy stay behind redemption.
 *
 * ## Why every failure is the same `null`
 *
 * Expired, revoked, exhausted, wrong-purpose and never-existed are one answer
 * here. Redemption distinguishes them because the caller has proven who they
 * are; an unauthenticated preview that distinguished them would report on the
 * lifecycle of a church's invitations to whoever held a spent link.
 *
 * Nothing is written. `used_count` is untouched, so previewing a single-use
 * invitation on the sign-in screen cannot burn it before the person arrives.
 */
export async function previewInvitation(
  rawToken: string,
): Promise<InvitationPreview | null> {
  if (rawToken.length < 16 || rawToken.length > 512) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("visitor_invitations")
    .select("purpose, max_uses, used_count, expires_at, revoked_at, churches(slug, name, logo_url)")
    .eq("token_hash", hashInvitationToken(rawToken))
    .maybeSingle();

  if (!data) return null;
  // The same gates `consume_visitor_invitation` applies, read-only. The blocked
  // check is deliberately absent: it needs an account, and there is none yet.
  if (data.purpose !== "join") return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at as string).getTime() <= Date.now()) return null;
  if ((data.used_count as number) >= (data.max_uses as number)) return null;

  const church = data.churches as unknown as {
    slug: string;
    name: string;
    logo_url: string | null;
  } | null;
  if (!church) return null;

  return {
    churchSlug: church.slug,
    churchName: church.name,
    logoUrl: church.logo_url ?? null,
  };
}
