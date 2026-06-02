import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StripeOnboardingStatus } from "@/types/giving";
import { getSiteUrl } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";

export function deriveOnboardingStatus(
  account: Stripe.Account,
): StripeOnboardingStatus {
  if (account.charges_enabled && account.payouts_enabled) {
    return "active";
  }
  const due = account.requirements?.currently_due ?? [];
  if (due.length > 0) {
    return "restricted";
  }
  if (account.details_submitted) {
    return "pending";
  }
  if (account.id) {
    return "pending";
  }
  return "not_started";
}

export async function syncChurchFromStripeAccount(
  account: Stripe.Account,
): Promise<void> {
  const admin = createAdminClient();
  const churchId = account.metadata?.church_id;
  if (!churchId) {
    const { data: byAccount } = await admin
      .from("churches")
      .select("id")
      .eq("stripe_account_id", account.id)
      .maybeSingle();
    if (!byAccount?.id) return;
  }

  const targetChurchId = churchId ?? (
    await admin
      .from("churches")
      .select("id")
      .eq("stripe_account_id", account.id)
      .maybeSingle()
  ).data?.id;

  if (!targetChurchId) return;

  const status = deriveOnboardingStatus(account);
  const requirementsDue = account.requirements?.currently_due ?? [];
  const wasChargesEnabled = account.charges_enabled === true;

  const { data: existing } = await admin
    .from("churches")
    .select("giving_enabled_at, stripe_charges_enabled")
    .eq("id", targetChurchId)
    .single();

  const givingEnabledAt =
    wasChargesEnabled && !existing?.stripe_charges_enabled
      ? new Date().toISOString()
      : wasChargesEnabled
        ? (existing?.giving_enabled_at ?? new Date().toISOString())
        : null;

  await admin
    .from("churches")
    .update({
      stripe_account_id: account.id,
      stripe_charges_enabled: account.charges_enabled ?? false,
      stripe_payouts_enabled: account.payouts_enabled ?? false,
      stripe_details_submitted: account.details_submitted ?? false,
      stripe_onboarding_status: status,
      stripe_requirements_due: requirementsDue,
      giving_enabled_at: givingEnabledAt,
    })
    .eq("id", targetChurchId);
}

export async function createConnectedAccount(churchId: string, churchName: string) {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "standard",
    metadata: { church_id: churchId },
    business_profile: {
      name: churchName,
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });

  const admin = createAdminClient();
  await admin
    .from("churches")
    .update({
      stripe_account_id: account.id,
      stripe_onboarding_status: "pending",
    })
    .eq("id", churchId);

  return account;
}

export async function createAccountLink(
  stripeAccountId: string,
  churchId: string,
): Promise<string> {
  const stripe = getStripe();
  const base = getSiteUrl();
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${base}/dashboard/settings?stripe_refresh=1`,
    return_url: `${base}/dashboard/settings?stripe_return=1`,
    type: "account_onboarding",
  });
  return link.url;
}

export async function createLoginLink(stripeAccountId: string): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(stripeAccountId);
  return link.url;
}

export async function refreshAccountFromStripe(stripeAccountId: string) {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(stripeAccountId);
  await syncChurchFromStripeAccount(account);
  return account;
}

export async function markChurchDeauthorized(stripeAccountId: string) {
  const admin = createAdminClient();
  await admin
    .from("churches")
    .update({
      stripe_onboarding_status: "deauthorized",
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      giving_enabled_at: null,
    })
    .eq("stripe_account_id", stripeAccountId);
}
