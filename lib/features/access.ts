import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { cache } from "react";

import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import {
  FEATURE_KEYS,
  isFeatureKey,
  type FeatureKey,
} from "@/lib/features/catalog";
import {
  isDisabledReason,
  type FeatureNotice,
} from "@/lib/features/disabled-reason";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type FeatureFlags = Record<FeatureKey, boolean>;

/** Why each switched-off feature is off. Only holds entries for disabled ones. */
export type FeatureNotices = Partial<Record<FeatureKey, FeatureNotice>>;

export function churchFeatureCacheTag(churchId: string): string {
  return `church-features:${churchId}`;
}

/** Every feature ships enabled; a platform admin opts an account out. */
export function defaultFeatureFlags(): FeatureFlags {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, true]),
  ) as FeatureFlags;
}

function isMissingFeatureTable(message: string): boolean {
  return /church_features/i.test(message);
}

/**
 * Account-level flags for a church. Rows only exist for features a platform
 * admin has explicitly changed, so anything absent falls back to enabled.
 */
export async function getChurchFeatureFlags(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<FeatureFlags> {
  return (await getChurchFeatureState(churchId, supabase)).flags;
}

/**
 * Both halves of the account-level switch: whether each feature is on, and for
 * the ones that are off, why.
 */
async function readChurchFeatureState(
  churchId: string,
  client: SupabaseClient,
): Promise<{ flags: FeatureFlags; notices: FeatureNotices }> {
  const flags = defaultFeatureFlags();
  const notices: FeatureNotices = {};

  const withReason = () =>
    client
      .from("church_features")
      .select("feature_key, enabled, disabled_reason, disabled_note")
      .eq("church_id", churchId);

  let { data, error } = await withReason();

  // Pre-0049 databases have the switch but not the reason behind it.
  if (error && /disabled_reason|disabled_note/i.test(error.message)) {
    const legacy = await client
      .from("church_features")
      .select("feature_key, enabled")
      .eq("church_id", churchId);
    data = legacy.data as typeof data;
    error = legacy.error;
  }

  if (error) {
    // Pre-0041 environments simply behave as "everything on".
    if (!isMissingFeatureTable(error.message)) {
      console.error("getChurchFeatureFlags:", error.message);
    }
    return { flags, notices };
  }

  for (const row of data ?? []) {
    const key = row.feature_key as string;
    if (!isFeatureKey(key)) continue;

    flags[key] = Boolean(row.enabled);

    if (!flags[key]) {
      const reason = (row as { disabled_reason?: unknown }).disabled_reason;
      const note = (row as { disabled_note?: unknown }).disabled_note;
      notices[key] = {
        reason: isDisabledReason(reason) ? reason : null,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      };
    }
  }

  return { flags, notices };
}

export async function getChurchFeatureState(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ flags: FeatureFlags; notices: FeatureNotices }> {
  return readChurchFeatureState(churchId, supabase ?? createClient());
}

async function getCachedChurchFeatureState(churchId: string) {
  const admin = createAdminClientOrNull();
  if (!admin) {
    return readChurchFeatureState(churchId, createClient());
  }

  // Only tenant-level product switches are persisted here. The church id is
  // part of both the cache key and invalidation tag; user permissions and auth
  // claims remain request-local and can never cross users or churches.
  return unstable_cache(
    () => readChurchFeatureState(churchId, admin),
    ["church-feature-state", churchId],
    { revalidate: 300, tags: [churchFeatureCacheTag(churchId)] },
  )();
}

/**
 * One flag for one church, with no signed-in user involved.
 *
 * This is what the public surfaces use. `getFeatureAccess` answers "can this
 * member open this?", which is the wrong question for a visitor on
 * gracechurch.org or a donor on /give — there is no member. The only question
 * there is whether the church still has the feature at all.
 *
 * Reads through the service-role client because `church_features` has no anon
 * policy, and defaults to enabled so an unmigrated database or a transient
 * error never takes a church's public site down.
 */
export async function isChurchFeatureEnabled(
  churchId: string,
  key: FeatureKey,
): Promise<boolean> {
  const admin = createAdminClientOrNull();
  if (!admin) return true;

  const { data, error } = await admin
    .from("church_features")
    .select("enabled")
    .eq("church_id", churchId)
    .eq("feature_key", key)
    .maybeSingle();

  if (error) {
    if (!isMissingFeatureTable(error.message)) {
      console.error("isChurchFeatureEnabled:", error.message);
    }
    return true;
  }

  // No row means never changed, which means the catalog default: on.
  return data ? Boolean(data.enabled) : true;
}

export type FeatureAccess = {
  auth: ChurchAuth;
  /** Account-level switches set by platform admins. */
  flags: FeatureFlags;
  /** Why each switched-off feature is off. */
  notices: FeatureNotices;
  /** Features this specific user can actually open. */
  allowed: FeatureKey[];
};

export function resolveAllowedFeatures(
  auth: Pick<ChurchAuth, "isAdmin" | "featurePermissions">,
  flags: FeatureFlags,
): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => {
    if (!flags[key]) return false;
    return auth.isAdmin || auth.featurePermissions.includes(key);
  });
}

async function getFeatureAccessForClient(
  client?: SupabaseClient,
): Promise<FeatureAccess | null> {
  const auth = await getChurchAuth(client);
  if (!auth) return null;

  const { flags, notices } = client
    ? await getChurchFeatureState(auth.churchId, client)
    : await getCachedChurchFeatureState(auth.churchId);

  return {
    auth,
    flags,
    notices,
    allowed: resolveAllowedFeatures(auth, flags),
  };
}

const getFeatureAccessForRequest = cache(async () =>
  getFeatureAccessForClient(),
);

export function getFeatureAccess(
  supabase?: SupabaseClient,
): Promise<FeatureAccess | null> {
  return supabase
    ? getFeatureAccessForClient(supabase)
    : getFeatureAccessForRequest();
}

export function canAccessFeature(
  access: FeatureAccess | null,
  key: FeatureKey,
): boolean {
  if (!access) return false;
  return access.allowed.includes(key);
}

/**
 * Why a feature is unavailable — drives the message the member sees instead of
 * a generic "not found".
 */
export type FeatureBlockReason = "account_disabled" | "no_permission";

export function featureBlockReason(
  access: FeatureAccess,
  key: FeatureKey,
): FeatureBlockReason | null {
  if (!access.flags[key]) return "account_disabled";
  if (!access.allowed.includes(key)) return "no_permission";
  return null;
}
