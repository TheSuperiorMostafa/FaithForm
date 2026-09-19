import type { SupabaseClient } from "@supabase/supabase-js";

import { chatTeamForChurch, chatUserIdFor } from "@/lib/messaging/ids";
import type { ChatUserProfile } from "@/lib/messaging/provider";

/**
 * Who someone is in chat, derived — every time — from FaithForm.
 *
 * A person's chat tenants ("teams") are exactly the churches they may use
 * Groups in right now:
 *
 *   * as a member: a relationship that grants published content
 *     (`following`, `pending`, `joined`), never `left` or `blocked`, on an
 *     active account;
 *   * as staff: a `church_users` row that holds the Groups feature;
 *
 * and only where that church has Groups switched on. Everything else is
 * absent, so the provider's own tenant check refuses it independently of
 * FaithForm's. Staff additionally hold `ff_church_staff` in their church's
 * tenant: read and post in group channels without being a member, and nothing
 * at all in direct messages.
 */

export const STAFF_TEAM_ROLE = "ff_church_staff";

export type ChatIdentity = {
  authUserId: string;
  accountId: string | null;
  profile: ChatUserProfile;
  /** Churches reachable as a member. */
  memberChurchIds: string[];
  /** Churches reachable as staff with the Groups feature. */
  staffChurchIds: string[];
  /** The app account is active (not deactivated or being deleted). */
  active: boolean;
};

const MEMBER_STATES = ["following", "pending", "joined"];

/** Churches (of the given ones) where the Groups feature is on. */
export async function churchesWithGroups(
  admin: SupabaseClient,
  churchIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(churchIds)];
  if (unique.length === 0) return new Set();
  const { data, error } = await admin
    .from("church_features")
    .select("church_id, enabled")
    .in("church_id", unique)
    .eq("feature_key", "groups");
  // Fails closed: chat tenancy is an authorization input, unlike a public
  // website that should stay up when a flag read hiccups.
  if (error) return new Set();
  const disabled = new Set(
    ((data ?? []) as { church_id: string; enabled: boolean }[])
      .filter((row) => !row.enabled)
      .map((row) => row.church_id),
  );
  return new Set(unique.filter((id) => !disabled.has(id)));
}

type NameRow = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  account_id: string | null;
  account_status: string | null;
};

/** Identities for many sign-ins at once: a handful of queries, whatever the count. */
export async function resolveChatIdentities(
  admin: SupabaseClient,
  authUserIds: string[],
): Promise<Map<string, ChatIdentity>> {
  const ids = [...new Set(authUserIds)];
  const result = new Map<string, ChatIdentity>();
  if (ids.length === 0) return result;

  const [{ data: names, error: namesError }, { data: staffLinks, error: staffError }] = await Promise.all([
    admin.rpc("chat_display_names", { p_user_ids: ids }),
    admin
      .from("church_users")
      .select("user_id, church_id, role, feature_permissions")
      .in("user_id", ids),
  ]);
  if (namesError || staffError) throw new Error("Could not resolve chat identities.");

  const nameRows = (names ?? []) as NameRow[];
  const accountIds = nameRows.map((row) => row.account_id).filter((id): id is string => Boolean(id));

  let relationships: { account_id: string; church_id: string }[] = [];
  if (accountIds.length > 0) {
    const { data, error } = await admin
      .from("visitor_church_relationships")
      .select("account_id, church_id")
      .in("account_id", accountIds)
      .in("state", MEMBER_STATES);
    if (error) throw new Error("Could not resolve chat identities.");
    relationships = (data ?? []) as { account_id: string; church_id: string }[];
  }

  const staffRows = ((staffLinks ?? []) as {
    user_id: string;
    church_id: string;
    role: string;
    feature_permissions: string[] | null;
  }[]).filter((link) => link.role === "admin" || (link.feature_permissions ?? []).includes("groups"));

  const enabled = await churchesWithGroups(admin, [
    ...relationships.map((r) => r.church_id),
    ...staffRows.map((r) => r.church_id),
  ]);

  for (const row of nameRows) {
    const active = !row.account_id || row.account_status === "active";
    const memberChurchIds = active
      ? relationships
          .filter((r) => r.account_id === row.account_id && enabled.has(r.church_id))
          .map((r) => r.church_id)
      : [];
    const staffChurchIds = staffRows
      .filter((r) => r.user_id === row.user_id && enabled.has(r.church_id))
      .map((r) => r.church_id);

    if (!row.account_id && staffChurchIds.length === 0) continue;

    const teamRoles: Record<string, string> = {};
    for (const churchId of memberChurchIds) teamRoles[chatTeamForChurch(churchId)] = "user";
    for (const churchId of staffChurchIds) teamRoles[chatTeamForChurch(churchId)] = STAFF_TEAM_ROLE;

    result.set(row.user_id, {
      authUserId: row.user_id,
      accountId: row.account_id,
      active,
      memberChurchIds,
      staffChurchIds,
      profile: {
        chatUserId: chatUserIdFor(row.user_id),
        name: row.name ?? (staffChurchIds.length > 0 ? "Church staff" : "Church member"),
        image: typeof row.avatar_url === "string" && /^https:\/\//.test(row.avatar_url) ? row.avatar_url : null,
        teams: Object.keys(teamRoles).sort(),
        teamRoles,
        isStaff: staffChurchIds.length > 0,
      },
    });
  }

  return result;
}

export async function resolveChatIdentity(
  admin: SupabaseClient,
  authUserId: string,
): Promise<ChatIdentity | null> {
  return (await resolveChatIdentities(admin, [authUserId])).get(authUserId) ?? null;
}

/** A stable fingerprint of what the provider was last told. */
export function profileFingerprint(profile: ChatUserProfile): string {
  return JSON.stringify([
    profile.name,
    profile.image,
    [...profile.teams].sort(),
    Object.entries(profile.teamRoles).sort(([a], [b]) => a.localeCompare(b)),
    profile.isStaff,
  ]);
}

/** Records the binding a chat identity lives under. Idempotent. */
export async function ensureBindings(admin: SupabaseClient, authUserIds: string[]): Promise<void> {
  const rows = [...new Set(authUserIds)].map((userId) => ({
    user_id: userId,
    chat_user_id: chatUserIdFor(userId),
  }));
  if (rows.length === 0) return;
  const { error } = await admin
    .from("messaging_user_bindings")
    .upsert(rows, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw new Error("Could not record chat identities.");
}

/** The sign-in behind a chat identity, when FaithForm made it. */
export async function authUserForChatId(admin: SupabaseClient, chatUserId: string): Promise<string | null> {
  const { data } = await admin
    .from("messaging_user_bindings")
    .select("user_id")
    .eq("chat_user_id", chatUserId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/**
 * Tells the provider who these people are, when what it was last told is out
 * of date. Returns the chat ids that lost a tenant (their tokens should be
 * revoked).
 */
export async function provisionChatUsers(
  admin: SupabaseClient,
  provider: { upsertUsers(users: ChatUserProfile[]): Promise<void> },
  identities: ChatIdentity[],
  options: { force?: boolean } = {},
): Promise<{ provisioned: number; lostTenant: string[] }> {
  if (identities.length === 0) return { provisioned: 0, lostTenant: [] };
  await ensureBindings(admin, identities.map((identity) => identity.authUserId));

  const { data: bindings } = await admin
    .from("messaging_user_bindings")
    .select("user_id, synced_profile_hash, synced_teams")
    .in("user_id", identities.map((identity) => identity.authUserId));
  const byUser = new Map(
    ((bindings ?? []) as { user_id: string; synced_profile_hash: string | null; synced_teams: string[] }[]).map(
      (row) => [row.user_id, row],
    ),
  );

  const stale = identities.filter(
    (identity) =>
      options.force ||
      byUser.get(identity.authUserId)?.synced_profile_hash !== profileFingerprint(identity.profile),
  );
  if (stale.length === 0) return { provisioned: 0, lostTenant: [] };

  await provider.upsertUsers(stale.map((identity) => identity.profile));

  const lostTenant: string[] = [];
  const now = new Date().toISOString();
  for (const identity of stale) {
    const previous = byUser.get(identity.authUserId)?.synced_teams ?? [];
    if (previous.some((team) => !identity.profile.teams.includes(team))) {
      lostTenant.push(identity.profile.chatUserId);
    }
    await admin
      .from("messaging_user_bindings")
      .update({
        synced_profile_hash: profileFingerprint(identity.profile),
        synced_teams: identity.profile.teams,
        synced_at: now,
        updated_at: now,
      })
      .eq("user_id", identity.authUserId);
  }
  return { provisioned: stale.length, lostTenant };
}
