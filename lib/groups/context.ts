import type { SupabaseClient } from "@supabase/supabase-js";

import { requireActiveAccount, type VisitorAccount } from "@/lib/faithform/account";
import { VisitorError } from "@/lib/faithform/errors";
import { churchSlugSchema } from "@/lib/faithform/schemas";
import type { RelationshipState } from "@/lib/faithform/relationship-state";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import type { GroupActor } from "@/lib/groups/permissions";
import type { GroupRole, GroupStatus } from "@/lib/groups/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who is asking, in which church — re-derived on every request.
 *
 * A mobile caller names a church by its public slug and a group by its id.
 * Neither is trusted: the account comes from the verified token, the church
 * from the slug *and* a live relationship with it, and every group is loaded
 * with an exact `church_id` predicate. A group id from another church, a
 * private group the caller is not in, a deleted group and a group that never
 * existed all answer the same `not_found`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MemberContext = {
  userId: string;
  account: VisitorAccount;
  church: { id: string; slug: string; name: string; timezone: string; logoUrl: string | null };
  relationshipState: RelationshipState;
  admin: SupabaseClient;
};

export async function resolveMemberContext(userId: string, churchSlug: string): Promise<MemberContext> {
  const account = await requireActiveAccount(userId);
  const slug = churchSlugSchema.safeParse(churchSlug);
  if (!slug.success) throw new VisitorError("church_not_found", "Church not found.");

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id, slug, name, timezone, logo_url")
    .eq("slug", slug.data)
    .maybeSingle();
  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  const { data: relationship } = await admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", account.id)
    .eq("church_id", church.id as string)
    .maybeSingle();
  const state = relationship?.state as RelationshipState | undefined;
  if (state === "blocked") throw new VisitorError("blocked", "This account is blocked by the church.");
  if (!state || !["following", "pending", "joined"].includes(state)) {
    // Indistinguishable from a church that does not exist.
    throw new VisitorError("church_not_found", "Church not found.");
  }

  if (!(await isChurchFeatureEnabled(church.id as string, "groups"))) {
    throw new VisitorError("forbidden", "Groups aren't available at this church.");
  }

  return {
    userId,
    account,
    church: {
      id: church.id as string,
      slug: church.slug as string,
      name: church.name as string,
      timezone: (church.timezone as string | null) ?? "America/New_York",
      logoUrl: (church.logo_url as string | null) ?? null,
    },
    relationshipState: state,
    admin,
  };
}

export type MembershipRow = {
  id: string;
  group_role: GroupRole;
  status: "active" | "left" | "removed";
  notification_level: string;
  member_id: string | null;
  account_id: string | null;
  joined_at: string;
};

export type GroupAccess = {
  group: Record<string, unknown> & { id: string; church_id: string; status: GroupStatus };
  membership: MembershipRow | null;
  pendingRequestId: string | null;
  banned: boolean;
  actor: GroupActor;
};

/**
 * A group as the caller may see it. Refuses — as `not_found` — anything the
 * caller has no business knowing exists.
 */
export async function loadGroupForMember(
  ctx: MemberContext,
  groupId: string,
  columns = "*",
): Promise<GroupAccess> {
  if (!UUID.test(groupId)) throw new VisitorError("group_not_found", "Group not found.");

  const [{ data: group }, { data: linkedMember }] = await Promise.all([
    ctx.admin
      .from("groups")
      .select(columns)
      .eq("id", groupId)
      .eq("church_id", ctx.church.id)
      .neq("status", "deleted")
      .maybeSingle(),
    ctx.admin.rpc("linked_member_id", { p_account_id: ctx.account.id, p_church_id: ctx.church.id }),
  ]);
  if (!group) throw new VisitorError("group_not_found", "Group not found.");
  const row = group as unknown as GroupAccess["group"] & { visibility?: string };

  const [{ data: membership }, { data: request }, { data: banned }] = await Promise.all([
    ctx.admin.rpc("group_membership_for_account", { p_group_id: groupId, p_account_id: ctx.account.id }),
    ctx.admin
      .from("group_join_requests")
      .select("id")
      .eq("group_id", groupId)
      .eq("account_id", ctx.account.id)
      .eq("status", "pending")
      .maybeSingle(),
    ctx.admin.rpc("group_is_banned", {
      p_group_id: groupId,
      p_account_id: ctx.account.id,
      p_member_id: (linkedMember as string | null) ?? null,
    }),
  ]);

  const member = (Array.isArray(membership) ? membership[0] : membership) as MembershipRow | null;
  const activeMember = member?.id && member.status === "active" ? member : null;

  // Visibility: members see their group in any lifecycle state it still has;
  // everyone else sees an active group only when it is not private.
  const visible =
    Boolean(activeMember) ||
    Boolean(request?.id) ||
    (row.status === "active" && row.visibility !== "private");
  if (!visible) throw new VisitorError("group_not_found", "Group not found.");

  return {
    group: row,
    membership: activeMember,
    pendingRequestId: (request?.id as string | undefined) ?? null,
    banned: banned === true,
    actor: activeMember ? { kind: "member", role: activeMember.group_role } : { kind: "outsider" },
  };
}

/** Whether a string is shaped like one of our ids, before it reaches a query. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
