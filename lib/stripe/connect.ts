import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StripeOnboardingStatus } from "@/types/giving";
import { getSiteUrl } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";
import { isMissingFundAccountSchema } from "@/lib/giving/stripe-accounts";

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

/** Set on accounts FaithForm creates for a fund, so a sync never treats one as a church's primary. */
export const FUND_ACCOUNT_METADATA_KEY = "faithform_fund_account";

function payoutScheduleOf(account: Stripe.Account): Record<string, unknown> | null {
  const schedule = account.settings?.payouts?.schedule;
  if (!schedule) return null;
  return {
    interval: schedule.interval ?? null,
    delay_days: schedule.delay_days ?? null,
    weekly_anchor: schedule.weekly_anchor ?? null,
    monthly_anchor: schedule.monthly_anchor ?? null,
  };
}

function accountRowFields(account: Stripe.Account) {
  const status = deriveOnboardingStatus(account);
  return {
    status: status === "not_started" ? "pending" : status,
    details_submitted: account.details_submitted ?? false,
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    requirements_due: account.requirements?.currently_due ?? [],
    payout_schedule: payoutScheduleOf(account),
    updated_at: new Date().toISOString(),
  };
}

export type AccountSyncResult = {
  churchId: string;
  accountRowId: string | null;
  isPrimary: boolean;
  /** Stripe started asking for something it was not asking for before. */
  requirementsBecameDue: boolean;
  requirementsDue: string[];
};

function dueList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Applies a connected account's latest state.
 *
 * A fund account updates only its own `giving_stripe_accounts` row. Only the
 * church's primary account writes the `churches` columns, and an event for an
 * account that is not the church's current primary never replaces it: before
 * fund accounts existed, any account whose metadata named a church became that
 * church's account, which would have moved the General Fund's money to the
 * first fund account Stripe sent an update for.
 */
export async function syncChurchFromStripeAccount(
  account: Stripe.Account,
): Promise<AccountSyncResult | null> {
  const admin = createAdminClient();

  const { data: row, error: rowError } = await admin
    .from("giving_stripe_accounts")
    .select("id, church_id, is_primary, requirements_due")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  if (rowError && !isMissingFundAccountSchema(rowError)) {
    throw new Error("stripe_account_row_lookup_failed");
  }

  if (row && row.is_primary !== true) {
    const fields = accountRowFields(account);
    const { error } = await admin
      .from("giving_stripe_accounts")
      .update(fields)
      .eq("id", row.id);
    if (error) throw new Error("stripe_account_row_sync_failed");
    if (fields.charges_enabled && fields.payouts_enabled && fields.status === "active") {
      // Funds waiting for this account switch to it now that it can take money.
      const { error: promoteError } = await admin
        .from("giving_funds")
        .update({
          giving_stripe_account_id: row.id,
          pending_giving_stripe_account_id: null,
        })
        .eq("church_id", row.church_id)
        .eq("pending_giving_stripe_account_id", row.id);
      if (promoteError) throw new Error("stripe_account_fund_switch_failed");
    }
    const before = dueList(row.requirements_due);
    return {
      churchId: row.church_id as string,
      accountRowId: row.id as string,
      isPrimary: false,
      requirementsBecameDue: before.length === 0 && fields.requirements_due.length > 0,
      requirementsDue: fields.requirements_due,
    };
  }

  if (!row && account.metadata?.[FUND_ACCOUNT_METADATA_KEY] === "true") {
    // Created moments ago; its row is written right after Stripe answers.
    // Retrying lets the row land rather than mistaking it for a primary.
    throw new Error("stripe_fund_account_not_ready");
  }

  const metadataChurchId = account.metadata?.church_id || null;
  const { data: byAccount } = await admin
    .from("churches")
    .select("id")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  const targetChurchId = (byAccount?.id as string | undefined) ?? metadataChurchId;
  if (!targetChurchId) return null;

  const status = deriveOnboardingStatus(account);
  const requirementsDue = account.requirements?.currently_due ?? [];
  const wasChargesEnabled = account.charges_enabled === true;

  const { data: existing } = await admin
    .from("churches")
    .select("stripe_account_id, giving_enabled_at, stripe_charges_enabled, stripe_requirements_due")
    .eq("id", targetChurchId)
    .single();

  const currentPrimary = (existing?.stripe_account_id as string | null) ?? null;
  if (currentPrimary && currentPrimary !== account.id) {
    console.warn("[stripe] account update for a non-primary account ignored", {
      account: account.id,
    });
    return null;
  }

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

  const primaryRowId = await mirrorPrimaryAccountRow(admin, targetChurchId, account, row?.id as string | undefined);

  const before = dueList(existing?.stripe_requirements_due);
  return {
    churchId: targetChurchId,
    accountRowId: primaryRowId,
    isPrimary: true,
    requirementsBecameDue: before.length === 0 && requirementsDue.length > 0,
    requirementsDue,
  };
}

/**
 * Keeps the primary account's `giving_stripe_accounts` row in step with the
 * `churches` columns, creating it for a church that connects after 0182. Best
 * effort: the churches columns remain what giving reads for the primary.
 */
async function mirrorPrimaryAccountRow(
  admin: ReturnType<typeof createAdminClient>,
  churchId: string,
  account: Stripe.Account,
  existingRowId: string | undefined,
): Promise<string | null> {
  const fields = accountRowFields(account);
  if (existingRowId) {
    const { error } = await admin.from("giving_stripe_accounts").update(fields).eq("id", existingRowId);
    if (error && !isMissingFundAccountSchema(error)) {
      console.warn("[stripe] primary account mirror failed", { account: account.id });
    }
    return existingRowId;
  }
  const { data, error } = await admin
    .from("giving_stripe_accounts")
    .insert({
      church_id: churchId,
      stripe_account_id: account.id,
      label: "Main account",
      is_primary: true,
      ...fields,
    })
    .select("id")
    .maybeSingle();
  if (error && !isMissingFundAccountSchema(error)) {
    console.warn("[stripe] primary account mirror failed", { account: account.id });
  }
  return (data?.id as string | undefined) ?? null;
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
    // Onboarding starts and finishes on the Giving page, which refreshes the
    // account status on return (see components/giving/stripe-return.tsx).
    refresh_url: `${base}/dashboard/giving?stripe_refresh=1`,
    return_url: `${base}/dashboard/giving?stripe_return=1`,
    type: "account_onboarding",
  });
  return link.url;
}

export async function createLoginLink(stripeAccountId: string): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(stripeAccountId);
  return link.url;
}

/**
 * Stripe answers `account_invalid` when the stored connected account does not
 * belong to the platform behind the current secret key — typically after the
 * platform's Stripe keys are swapped for a different Stripe account.
 */
function isAccountInaccessible(err: unknown): boolean {
  const e = err as { code?: string; type?: string } | null;
  const status = (err as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (err as { status?: number } | null)?.status;
  return e?.code === "account_invalid"
    || e?.code === "permission_denied"
    || status === 403;
}

/** Unlinks a connected account the current platform key can no longer reach. */
async function forgetConnectedAccount(stripeAccountId: string) {
  const admin = createAdminClient();
  await admin
    .from("churches")
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
      stripe_onboarding_status: "not_started",
      stripe_requirements_due: [],
      giving_enabled_at: null,
    })
    .eq("stripe_account_id", stripeAccountId);
  await disableAccountRow(stripeAccountId, { demotePrimary: true });
}

/**
 * Marks an account's row unable to take gifts. A fund pointing at it stops
 * appearing on giving forms; it is never moved to another account silently.
 */
async function disableAccountRow(
  stripeAccountId: string,
  options: { demotePrimary: boolean },
): Promise<{ churchId: string; accountRowId: string; isPrimary: boolean } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("giving_stripe_accounts")
    .update({
      status: "deauthorized",
      charges_enabled: false,
      payouts_enabled: false,
      ...(options.demotePrimary ? { is_primary: false } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", stripeAccountId)
    .select("id, church_id, is_primary")
    .maybeSingle();
  if (error) {
    if (!isMissingFundAccountSchema(error)) {
      console.warn("[stripe] account row disable failed", { account: stripeAccountId });
    }
    return null;
  }
  if (!data) return null;
  return {
    churchId: data.church_id as string,
    accountRowId: data.id as string,
    isPrimary: data.is_primary === true,
  };
}

/**
 * Pulls the connected account's latest state into the church row. Returns null
 * (and unlinks it) when the account is unreachable with the current key, so
 * callers can start fresh onboarding instead of failing forever.
 */
export async function refreshAccountFromStripe(
  stripeAccountId: string,
): Promise<Stripe.Account | null> {
  const stripe = getStripe();
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(stripeAccountId);
  } catch (err) {
    if (!isAccountInaccessible(err)) throw err;
    console.warn(
      `[stripe] connected account ${stripeAccountId} is not accessible with the current key; unlinking it`,
    );
    await forgetConnectedAccount(stripeAccountId);
    return null;
  }
  await syncChurchFromStripeAccount(account);
  return account;
}

export async function markChurchDeauthorized(
  stripeAccountId: string,
): Promise<{ churchId: string; accountRowId: string; isPrimary: boolean } | null> {
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
  return disableAccountRow(stripeAccountId, { demotePrimary: false });
}

// ---------------------------------------------------------------------------
// Fund accounts
// ---------------------------------------------------------------------------

/** Stripe's merchant category for religious organizations. */
const RELIGIOUS_ORGANIZATION_MCC = "8661";

/**
 * Creates a Standard connected account for one fund and records it.
 *
 * Only what FaithForm already knows is prefilled. The church's EIN, its
 * representative and the fund's bank account are entered by the treasurer in
 * Stripe's own onboarding, never in FaithForm.
 *
 * The idempotency key is per row id generated here, so a retried request for
 * the same attempt cannot create two Stripe accounts.
 */
export async function createFundConnectedAccount(input: {
  churchId: string;
  churchName: string;
  label: string;
  treasurerEmail: string | null;
  websiteUrl: string | null;
  attemptKey: string;
}): Promise<{ accountRowId: string; stripeAccountId: string }> {
  const stripe = getStripe();
  const params: Stripe.AccountCreateParams = {
    type: "standard",
    country: "US",
    business_type: "non_profit",
    ...(input.treasurerEmail ? { email: input.treasurerEmail } : {}),
    company: { name: input.churchName },
    business_profile: {
      name: `${input.churchName} — ${input.label}`.slice(0, 120),
      mcc: RELIGIOUS_ORGANIZATION_MCC,
      ...(input.websiteUrl ? { url: input.websiteUrl } : {}),
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      church_id: input.churchId,
      [FUND_ACCOUNT_METADATA_KEY]: "true",
    },
  };
  const account = await stripe.accounts.create(params, {
    idempotencyKey: `ff-fund-account-${input.attemptKey}`,
  });

  const admin = createAdminClient();
  const inserted = await admin
    .from("giving_stripe_accounts")
    .insert({
      church_id: input.churchId,
      stripe_account_id: account.id,
      label: input.label,
      is_primary: false,
      ...accountRowFields(account),
    })
    .select("id, church_id")
    .single();
  let data = inserted.data;
  let error = inserted.error;
  if (error?.code === "23505") {
    // A replayed request: Stripe returned the account it already made.
    ({ data, error } = await admin
      .from("giving_stripe_accounts")
      .select("id, church_id")
      .eq("stripe_account_id", account.id)
      .single());
  }
  if (error || !data || data.church_id !== input.churchId) {
    console.error("[stripe] fund account row write failed", { account: account.id });
    throw new Error("fund_account_record_failed");
  }
  return { accountRowId: data.id as string, stripeAccountId: account.id };
}

/**
 * A fresh onboarding link for a fund account. Links are single use and expire,
 * so one is made on every click rather than stored.
 */
export async function createFundAccountLink(
  stripeAccountId: string,
  accountRowId: string,
): Promise<string> {
  const stripe = getStripe();
  const base = getSiteUrl();
  const page = `${base}/dashboard/giving/funds`;
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${page}?account=${encodeURIComponent(accountRowId)}&stripe_refresh=1`,
    return_url: `${page}?account=${encodeURIComponent(accountRowId)}&stripe_return=1`,
    type: "account_onboarding",
  });
  return link.url;
}
