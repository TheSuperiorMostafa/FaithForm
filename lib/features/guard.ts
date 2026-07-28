import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canAccessFeature,
  getFeatureAccess,
  type FeatureAccess,
} from "@/lib/features/access";
import type { FeatureKey } from "@/lib/features/catalog";

export type FeatureGuardResult =
  | { ok: true; access: FeatureAccess }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Route-handler guard. Mirrors the page-level `<FeatureGate>` so an API call
 * cannot reach data the member's nav no longer offers.
 */
export async function guardFeature(
  key: FeatureKey,
  supabase?: SupabaseClient,
): Promise<FeatureGuardResult> {
  const access = await getFeatureAccess(supabase);

  if (!access) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (!canAccessFeature(access, key)) {
    return {
      ok: false,
      status: 403,
      error: !access.flags[key]
        ? "This feature is not enabled for your account."
        : "You do not have access to this feature.",
    };
  }

  return { ok: true, access };
}

export function featureGuardResponse(
  result: Extract<FeatureGuardResult, { ok: false }>,
): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/**
 * Convenience wrapper for route handlers:
 *
 *   const guard = await requireFeatureApi("giving");
 *   if (!guard.ok) return guard.response;
 *   // guard.access.auth.churchId is safe to use
 */
export async function requireFeatureApi(
  key: FeatureKey,
  supabase?: SupabaseClient,
): Promise<
  | { ok: true; access: FeatureAccess; response?: never }
  | { ok: false; access?: never; response: NextResponse }
> {
  const result = await guardFeature(key, supabase);
  if (!result.ok) {
    return { ok: false, response: featureGuardResponse(result) };
  }
  return { ok: true, access: result.access };
}

/**
 * Drop-in guard for route handlers that already do their own auth:
 *
 *   const denied = await featureAccessDenied("giving");
 *   if (denied) return denied;
 *
 * Returns null when the caller may proceed.
 */
export async function featureAccessDenied(
  key: FeatureKey,
  supabase?: SupabaseClient,
): Promise<NextResponse | null> {
  const result = await guardFeature(key, supabase);
  return result.ok ? null : featureGuardResponse(result);
}

/** Server-action guard. Returns an error string, or null when access is fine. */
export async function featureActionError(
  key: FeatureKey,
  supabase?: SupabaseClient,
): Promise<string | null> {
  const result = await guardFeature(key, supabase);
  return result.ok ? null : result.error;
}
