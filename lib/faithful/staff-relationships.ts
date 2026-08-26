import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { pageSchema } from "@/lib/faithful/schemas";
import { staffRelationshipAction } from "@/lib/faithful/relationships";
import type { JoinPolicy, RelationshipState } from "@/lib/faithful/relationship-state";

/**
 * The church's view of its visitors.
 *
 * Deliberately thin: staff see a display name, a state and a date. The visitor
 * account row itself is never exposed — consent state, contact preferences and
 * policy versions are the account's own business, not the church's.
 */

export type ChurchRelationshipRow = {
  accountId: string;
  displayName: string | null;
  state: RelationshipState;
  requestedAt: string | null;
  updatedAt: string;
};

export async function listChurchRelationships(
  churchId: string,
  input?: unknown,
): Promise<{ items: ChurchRelationshipRow[]; nextCursor: string | null }> {
  const parsed = pageSchema.safeParse(input ?? {});
  if (!parsed.success) throw new VisitorError("invalid_input", "Check your request.");
  const { limit, cursorId } = parsed.data;

  const admin = createAdminClient();

  let query = admin
    .from("visitor_church_relationships")
    .select(
      "id, account_id, state, requested_at, updated_at, visitor_accounts!inner(display_name)",
    )
    .eq("church_id", churchId)
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (cursorId) query = query.gt("id", cursorId);

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load visitors.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    items: page.map((row) => {
      const account = row.visitor_accounts as
        | { display_name: string | null }
        | { display_name: string | null }[];
      const resolved = Array.isArray(account) ? account[0] : account;
      return {
        accountId: row.account_id as string,
        displayName: resolved?.display_name ?? null,
        state: row.state as RelationshipState,
        requestedAt: (row.requested_at as string | null) ?? null,
        updatedAt: row.updated_at as string,
      };
    }),
    nextCursor: hasMore ? (page[page.length - 1].id as string) : null,
  };
}

/**
 * A staff decision on one visitor relationship. The join policy is read from
 * the church row rather than passed in, so a stale form cannot make an
 * approval behave as though a different policy were in force.
 */
export async function staffRelationshipDecision(input: {
  churchId: string;
  staffUserId: string;
  accountId: string;
  action: "approve" | "reject" | "block" | "unblock" | "revoke";
  reason?: string;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: church } = await admin
    .from("churches")
    .select("join_policy")
    .eq("id", input.churchId)
    .maybeSingle();

  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  await staffRelationshipAction({
    churchId: input.churchId,
    churchJoinPolicy: (church.join_policy as JoinPolicy) ?? "approval_required",
    accountId: input.accountId,
    action: input.action,
    staffUserId: input.staffUserId,
    reason: input.reason,
  });
}
