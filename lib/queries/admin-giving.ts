import { createAdminClient } from "@/lib/supabase/admin";
import type { StripeOnboardingStatus } from "@/types/giving";

export type AdminGivingOverview = {
  notStarted: number;
  pending: number;
  restricted: number;
  live: number;
  deauthorized: number;
  platformVolumeCents: number;
  stuckChurches: AdminGivingStuckRow[];
};

export type AdminGivingStuckRow = {
  id: string;
  name: string;
  slug: string;
  stripeOnboardingStatus: StripeOnboardingStatus;
  stripeRequirementsDue: string[];
  stripeChargesEnabled: boolean;
};

export type AdminChurchGivingStatus = {
  stripeOnboardingStatus: StripeOnboardingStatus;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  givingEnabledAt: string | null;
  slug: string;
};

export async function getAdminGivingOverview(): Promise<AdminGivingOverview> {
  const admin = createAdminClient();

  const { data: churches } = await admin
    .from("churches")
    .select(
      "id, name, slug, stripe_onboarding_status, stripe_requirements_due, stripe_charges_enabled, stripe_details_submitted",
    );

  const rows = churches ?? [];
  const counts = {
    notStarted: 0,
    pending: 0,
    restricted: 0,
    live: 0,
    deauthorized: 0,
  };

  const stuckChurches: AdminGivingStuckRow[] = [];

  for (const c of rows) {
    const status = c.stripe_onboarding_status as StripeOnboardingStatus;
    if (status === "not_started") counts.notStarted += 1;
    else if (status === "pending") counts.pending += 1;
    else if (status === "restricted") counts.restricted += 1;
    else if (status === "active") counts.live += 1;
    else if (status === "deauthorized") counts.deauthorized += 1;

    const due = Array.isArray(c.stripe_requirements_due)
      ? (c.stripe_requirements_due as string[])
      : [];
    if (
      status !== "active" &&
      (due.length > 0 || !c.stripe_details_submitted)
    ) {
      stuckChurches.push({
        id: c.id as string,
        name: c.name as string,
        slug: c.slug as string,
        stripeOnboardingStatus: status,
        stripeRequirementsDue: due,
        stripeChargesEnabled: Boolean(c.stripe_charges_enabled),
      });
    }
  }

  const { data: volumeRows } = await admin
    .from("giving_donations")
    .select("amount_cents")
    .eq("status", "succeeded");

  const platformVolumeCents = (volumeRows ?? []).reduce(
    (acc, r) => acc + (r.amount_cents as number),
    0,
  );

  return {
    ...counts,
    platformVolumeCents,
    stuckChurches: stuckChurches.slice(0, 20),
  };
}

export async function getAdminChurchGivingStatus(
  churchId: string,
): Promise<AdminChurchGivingStatus | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select(
      "slug, stripe_onboarding_status, stripe_charges_enabled, stripe_payouts_enabled, giving_enabled_at, stripe_account_id, stripe_requirements_due, stripe_details_submitted",
    )
    .eq("id", churchId)
    .maybeSingle();

  if (!data) return null;

  return {
    slug: data.slug as string,
    stripeOnboardingStatus: data.stripe_onboarding_status as StripeOnboardingStatus,
    stripeChargesEnabled: Boolean(data.stripe_charges_enabled),
    stripePayoutsEnabled: Boolean(data.stripe_payouts_enabled),
    givingEnabledAt: (data.giving_enabled_at as string) ?? null,
  };
}

export async function getAdminChurchStripeAccountId(
  churchId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", churchId)
    .maybeSingle();
  return (data?.stripe_account_id as string) ?? null;
}
