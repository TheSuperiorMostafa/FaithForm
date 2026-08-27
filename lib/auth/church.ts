import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import {
  isMissingFeaturePermissionsColumn,
  readGrantsFromAppMetadata,
} from "@/lib/auth/feature-grants";
import { parseFeatureKeys, type FeatureKey } from "@/lib/features/catalog";

export type ChurchAuth = {
  userId: string;
  userEmail: string;
  churchId: string;
  churchName: string | null;
  churchTimezone: string;
  role: string;
  isAdmin: boolean;
  /**
   * Explicit per-feature grants for this member. Church admins hold every
   * feature implicitly, so this is only consulted for non-admins.
   */
  featurePermissions: FeatureKey[];
};

type ChurchUserLink = {
  church_id: string;
  role: string;
  feature_permissions?: unknown;
  churches?:
    | { name: string | null; timezone: string | null }
    | { name: string | null; timezone: string | null }[]
    | null;
  /** True when the row came from the pre-0041 column set. */
  __legacy?: boolean;
};

const CHURCH_COLUMNS = "churches(name, timezone)";
const LINK_COLUMNS = `church_id, role, feature_permissions, ${CHURCH_COLUMNS}`;
const LINK_COLUMNS_LEGACY = `church_id, role, ${CHURCH_COLUMNS}`;

async function fetchChurchUserLink(
  client: SupabaseClient,
  userId: string,
): Promise<{ data: ChurchUserLink | null; error: { message: string } | null }> {
  const query = (columns: string) =>
    client
      .from("church_users")
      .select(columns)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  const { data, error } = await query(LINK_COLUMNS);

  // Tolerate the pre-0041 schema so an un-migrated environment still signs in.
  // The caller then reads grants from app_metadata instead.
  if (error && isMissingFeaturePermissionsColumn(error.message)) {
    const legacy = await query(LINK_COLUMNS_LEGACY);
    const row = (legacy.data as ChurchUserLink | null) ?? null;
    return {
      data: row ? { ...row, __legacy: true } : null,
      error: legacy.error,
    };
  }

  return { data: (data as ChurchUserLink | null) ?? null, error };
}

async function getChurchAuthWithClient(
  client: SupabaseClient,
): Promise<ChurchAuth | null> {
  // `getClaims` verifies the signed access token and, with Supabase's current
  // asymmetric signing keys, avoids putting the Auth server in every dashboard
  // render's critical path. Database RLS remains the final authorization layer.
  const { data, error: claimsError } = await client.auth.getClaims();
  const claims = data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;

  if (claimsError || !claims || !userId) return null;

  const { data: link, error } = await fetchChurchUserLink(client, userId);

  if (error) {
    console.error("getChurchAuth church_users:", error.message);
  }

  let resolvedLink = link;
  if (!resolvedLink?.church_id && process.env.NODE_ENV !== "production") {
    const admin = createAdminClientOrNull();
    if (admin) {
      const { data: adminLink, error: adminError } = await fetchChurchUserLink(
        admin,
        userId,
      );

      if (adminError) {
        console.error("getChurchAuth admin church_users:", adminError.message);
      }

      resolvedLink = adminLink;
    }
  }

  if (!resolvedLink?.church_id) return null;

  const role = resolvedLink.role as string;

  const church = Array.isArray(resolvedLink.churches)
    ? (resolvedLink.churches[0] ?? null)
    : (resolvedLink.churches ?? null);

  // The verified claims already carry app_metadata, so the legacy fallback
  // costs no extra round trip.
  const featurePermissions = resolvedLink.__legacy
    ? readGrantsFromAppMetadata(
        claims.app_metadata as Record<string, unknown> | null,
      )
    : parseFeatureKeys(resolvedLink.feature_permissions);

  return {
    userId,
    userEmail: typeof claims.email === "string" ? claims.email : "",
    churchId: resolvedLink.church_id as string,
    churchName: church?.name ?? null,
    churchTimezone: church?.timezone ?? "America/New_York",
    role,
    isAdmin: role === "admin",
    featurePermissions,
  };
}

// Supabase database calls are not automatically memoized by React. Keeping the
// zero-argument path in React's request cache means the dashboard layout,
// feature gates, and page share one verified identity + church membership read.
const getChurchAuthForRequest = cache(async () =>
  getChurchAuthWithClient(createClient()),
);

export function getChurchAuth(
  supabase?: SupabaseClient,
): Promise<ChurchAuth | null> {
  return supabase
    ? getChurchAuthWithClient(supabase)
    : getChurchAuthForRequest();
}

export async function requireChurchAuth(): Promise<ChurchAuth> {
  const auth = await getChurchAuth();
  if (!auth) {
    throw new Error("Unauthorized");
  }
  return auth;
}
