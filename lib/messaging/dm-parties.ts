import type { SupabaseClient } from "@supabase/supabase-js";

import type { DmParty } from "@/lib/messaging/dm-policy";

/**
 * Each person's standing for the direct-message policy, read in bulk from the
 * authorities: relationships, staff access, group memberships, restrictions.
 * Nothing here is read from the chat provider.
 */

const USABLE = ["following", "pending", "joined"];

export async function loadDmParties(
  admin: SupabaseClient,
  churchId: string,
  authUserIds: string[],
  now: Date = new Date(),
): Promise<Map<string, DmParty>> {
  const ids = [...new Set(authUserIds)];
  const parties = new Map<string, DmParty>();
  if (ids.length === 0) return parties;

  const [{ data: accounts }, { data: staff }, { data: restrictions }, { data: feature }] = await Promise.all([
    admin.from("visitor_accounts").select("id, user_id, status").in("user_id", ids),
    admin
      .from("church_users")
      .select("user_id, role, feature_permissions")
      .eq("church_id", churchId)
      .in("user_id", ids),
    admin
      .from("messaging_restrictions")
      .select("user_id, ends_at")
      .eq("church_id", churchId)
      .in("user_id", ids)
      .is("lifted_at", null),
    admin
      .from("church_features")
      .select("enabled")
      .eq("church_id", churchId)
      .eq("feature_key", "groups")
      .maybeSingle(),
  ]);

  const groupsOn = feature ? Boolean((feature as { enabled: boolean }).enabled) : true;
  const accountRows = (accounts ?? []) as { id: string; user_id: string; status: string }[];
  const accountByUser = new Map(accountRows.map((row) => [row.user_id, row]));
  const accountIds = accountRows.map((row) => row.id);

  const [{ data: relationships }, { data: memberships }] = accountIds.length
    ? await Promise.all([
        admin
          .from("visitor_church_relationships")
          .select("account_id, state")
          .eq("church_id", churchId)
          .in("account_id", accountIds),
        admin
          .from("group_memberships")
          .select("account_id, group_id, group_role, groups!inner(status, safety_profile)")
          .eq("church_id", churchId)
          .eq("status", "active")
          .in("account_id", accountIds),
      ])
    : [{ data: [] }, { data: [] }];

  const stateByAccount = new Map(
    ((relationships ?? []) as { account_id: string; state: string }[]).map((row) => [row.account_id, row.state]),
  );

  type MembershipRow = {
    account_id: string;
    group_id: string;
    group_role: string;
    groups: { status: string; safety_profile: string } | { status: string; safety_profile: string }[];
  };
  const membershipRows = ((memberships ?? []) as MembershipRow[]).map((row) => ({
    ...row,
    group: Array.isArray(row.groups) ? row.groups[0] : row.groups,
  }));

  const staffUsers = new Set(
    ((staff ?? []) as { user_id: string; role: string; feature_permissions: string[] | null }[])
      .filter((row) => groupsOn && (row.role === "admin" || (row.feature_permissions ?? []).includes("groups")))
      .map((row) => row.user_id),
  );

  const restricted = new Set(
    ((restrictions ?? []) as { user_id: string; ends_at: string | null }[])
      .filter((row) => !row.ends_at || Date.parse(row.ends_at) > now.getTime())
      .map((row) => row.user_id),
  );

  for (const userId of ids) {
    const account = accountByUser.get(userId);
    const state = account ? stateByAccount.get(account.id) : undefined;
    const own = account ? membershipRows.filter((row) => row.account_id === account.id && row.group?.status === "active") : [];
    parties.set(userId, {
      isStaff: staffUsers.has(userId),
      ledGroupIds: own.filter((row) => row.group_role !== "member").map((row) => row.group_id),
      memberGroupIds: own.map((row) => row.group_id),
      inYouthGroup: own.some((row) => row.group_role === "member" && row.group?.safety_profile === "youth"),
      eligible: Boolean(groupsOn && account && account.status === "active" && state && USABLE.includes(state)),
      restricted: restricted.has(userId),
    });
  }

  return parties;
}

/** Whether either person has blocked the other. */
export async function isBlockedEitherWay(
  admin: SupabaseClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  // Both are interpolated into a PostgREST filter, so both must be exactly a
  // uuid — never a value a caller could shape into a second condition.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(userA) || !uuid.test(userB)) return true;
  const { data } = await admin
    .from("messaging_blocks")
    .select("blocker_user_id")
    .or(
      `and(blocker_user_id.eq.${userA},blocked_user_id.eq.${userB}),and(blocker_user_id.eq.${userB},blocked_user_id.eq.${userA})`,
    )
    .limit(1);
  return (data ?? []).length > 0;
}
