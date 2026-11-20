import "server-only";

import { cache } from "react";
import { findShareByToken, loadSharedPlan, shareViewOptions, type ShareRow } from "@/lib/service-plans/share";
import type { Plan } from "@/lib/service-plans/types";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type SharedPlan = {
  share: ShareRow;
  plan: Plan;
  church: { name: string; timezone: string; logoUrl: string | null };
};

/**
 * Everything a share link may show, resolved with the service role behind
 * the token check. The token is the only key: no session, no table access for
 * the visitor. Cached per request so the page and its metadata read once.
 */
export const loadSharedPlanByToken = cache(async (token: string): Promise<SharedPlan | null> => {
  const admin = createAdminClientOrNull();
  if (!admin) return null;
  const share = await findShareByToken(admin, token);
  if (!share) return null;
  const [plan, church] = await Promise.all([
    loadSharedPlan(admin, share),
    admin.from("churches").select("name, timezone, logo_url").eq("id", share.church_id).maybeSingle(),
  ]);
  if (!plan) return null;
  return {
    share,
    plan,
    church: {
      name: (church.data?.name as string | null) ?? "Your church",
      timezone: (church.data?.timezone as string | null) ?? "America/New_York",
      logoUrl: (church.data?.logo_url as string | null) ?? null,
    },
  };
});

export { shareViewOptions };
