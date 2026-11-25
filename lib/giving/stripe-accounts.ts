import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which Stripe connected account a fund's gifts go to.
 *
 * A church has one primary account (`churches.stripe_account_id`, mirrored as
 * the `is_primary` row of `giving_stripe_accounts`) and may add one account per
 * fund so that fund's money lands in its own bank. A fund with no account set
 * (`giving_funds.giving_stripe_account_id` NULL) uses the primary account, which
 * is what every fund did before migration 0182.
 *
 * Everything Stripe-facing about one gift — the charge, the Customer, the
 * subscription, a refund, a cancellation — happens on the one account resolved
 * here, and that account is recorded on the gift so later actions never have to
 * re-derive it. The browser never chooses an account.
 */

export type GivingStripeAccountStatus = "pending" | "restricted" | "active" | "deauthorized";

export type GivingStripeAccount = {
  id: string;
  churchId: string;
  stripeAccountId: string;
  label: string;
  isPrimary: boolean;
  status: GivingStripeAccountStatus;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  payoutSchedule: { interval?: string; delayDays?: number | string; weeklyAnchor?: string; monthlyAnchor?: number } | null;
  bankName: string | null;
  bankLast4: string | null;
  createdAt: string;
};

export const GIVING_STRIPE_ACCOUNT_COLUMNS =
  "id, church_id, stripe_account_id, label, is_primary, status, details_submitted, charges_enabled, payouts_enabled, requirements_due, payout_schedule, bank_name, bank_last4, created_at";

export function mapGivingStripeAccount(row: Record<string, unknown>): GivingStripeAccount {
  const schedule = row.payout_schedule as Record<string, unknown> | null;
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    stripeAccountId: row.stripe_account_id as string,
    label: row.label as string,
    isPrimary: row.is_primary === true,
    status: (row.status as GivingStripeAccountStatus) ?? "pending",
    detailsSubmitted: row.details_submitted === true,
    chargesEnabled: row.charges_enabled === true,
    payoutsEnabled: row.payouts_enabled === true,
    requirementsDue: Array.isArray(row.requirements_due)
      ? (row.requirements_due as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    payoutSchedule: schedule
      ? {
          interval: schedule.interval as string | undefined,
          delayDays: schedule.delay_days as number | string | undefined,
          weeklyAnchor: schedule.weekly_anchor as string | undefined,
          monthlyAnchor: schedule.monthly_anchor as number | undefined,
        }
      : null,
    bankName: (row.bank_name as string | null) ?? null,
    bankLast4: (row.bank_last4 as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** A fund account may take gifts only once Stripe says it can charge and pay out. */
export function accountCanTakeGifts(
  account: Pick<GivingStripeAccount, "chargesEnabled" | "payoutsEnabled" | "status">,
): boolean {
  return account.chargesEnabled && account.payoutsEnabled && account.status === "active";
}

/**
 * A database that has not had migration 0182 applied refuses any select that
 * names its columns. Reading that as "no fund account" keeps every fund on the
 * primary account, which is exactly the pre-0182 behaviour.
 */
export function isMissingFundAccountSchema(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /giving_stripe_account_id|giving_stripe_accounts|giving_donor_stripe_customers/i.test(
      error.message ?? "",
    )
  );
}

export type FundAccountResolution =
  | { ok: true; stripeAccountId: string; isPrimary: boolean; accountRowId: string | null }
  | { ok: false; reason: "church_not_connected" | "fund_not_found" | "fund_account_not_ready" };

/**
 * The connected account a gift to `fundId` must be charged on.
 *
 * Refuses (rather than falling back to the primary account) when the fund has
 * its own account that cannot take money yet: a gift meant for the Missions
 * bank must never quietly land in the General bank.
 */
export async function resolveFundStripeAccount(
  churchId: string,
  fundId: string,
  db: SupabaseClient = createAdminClient(),
  /** The church's primary account when the caller has already checked it can charge. */
  knownPrimaryAccountId?: string,
): Promise<FundAccountResolution> {
  let primary = knownPrimaryAccountId ?? null;
  if (!primary) {
    const { data: church, error: churchError } = await db
      .from("churches")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("id", churchId)
      .maybeSingle();
    if (churchError) throw new Error("fund_account_church_lookup_failed");
    primary = (church?.stripe_account_id as string | null) ?? null;
    if (!primary || church?.stripe_charges_enabled !== true) {
      return { ok: false, reason: "church_not_connected" };
    }
  }

  const { data: fund, error: fundError } = await db
    .from("giving_funds")
    .select("id, giving_stripe_account_id")
    .eq("id", fundId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (fundError) {
    if (isMissingFundAccountSchema(fundError)) {
      return { ok: true, stripeAccountId: primary, isPrimary: true, accountRowId: null };
    }
    throw new Error("fund_account_fund_lookup_failed");
  }
  if (!fund) return { ok: false, reason: "fund_not_found" };

  const accountRowId = (fund.giving_stripe_account_id as string | null) ?? null;
  if (!accountRowId) {
    return { ok: true, stripeAccountId: primary, isPrimary: true, accountRowId: null };
  }

  const { data: row, error: rowError } = await db
    .from("giving_stripe_accounts")
    .select(GIVING_STRIPE_ACCOUNT_COLUMNS)
    .eq("id", accountRowId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (rowError) throw new Error("fund_account_lookup_failed");
  if (!row) return { ok: false, reason: "fund_account_not_ready" };

  const account = mapGivingStripeAccount(row as Record<string, unknown>);
  if (account.stripeAccountId === primary) {
    return { ok: true, stripeAccountId: primary, isPrimary: true, accountRowId: account.id };
  }
  if (!accountCanTakeGifts(account)) return { ok: false, reason: "fund_account_not_ready" };
  return {
    ok: true,
    stripeAccountId: account.stripeAccountId,
    isPrimary: false,
    accountRowId: account.id,
  };
}

/**
 * Fund ids that cannot take gifts right now because their own account is not
 * ready. Used to hide those funds from giving forms.
 */
export async function fundIdsAwaitingAccount(
  churchId: string,
  db: SupabaseClient = createAdminClient(),
): Promise<Set<string>> {
  const { data: funds, error } = await db
    .from("giving_funds")
    .select("id, giving_stripe_account_id")
    .eq("church_id", churchId)
    .not("giving_stripe_account_id", "is", null);
  if (error) {
    if (isMissingFundAccountSchema(error)) return new Set();
    throw new Error("fund_account_list_failed");
  }
  if (!funds?.length) return new Set();

  const { data: accounts, error: accountsError } = await db
    .from("giving_stripe_accounts")
    .select(GIVING_STRIPE_ACCOUNT_COLUMNS)
    .eq("church_id", churchId);
  if (accountsError) throw new Error("fund_account_list_failed");

  const ready = new Set(
    (accounts ?? [])
      .map((row) => mapGivingStripeAccount(row as Record<string, unknown>))
      .filter((a) => a.isPrimary || accountCanTakeGifts(a))
      .map((a) => a.id),
  );
  return new Set(
    funds
      .filter((f) => !ready.has(f.giving_stripe_account_id as string))
      .map((f) => f.id as string),
  );
}

export type StripeAccountOwner = {
  churchId: string;
  isPrimary: boolean;
  accountRowId: string | null;
};

/**
 * The church that owns a connected account, from either its primary column or
 * its fund-account row. Every webhook handler starts here.
 */
export async function churchForStripeAccount(
  stripeAccountId: string | undefined | null,
  db: SupabaseClient = createAdminClient(),
): Promise<StripeAccountOwner | null> {
  if (!stripeAccountId) return null;

  const { data: church, error } = await db
    .from("churches")
    .select("id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (error) throw new Error("stripe_church_lookup_failed");
  if (church?.id) return { churchId: church.id as string, isPrimary: true, accountRowId: null };

  const { data: row, error: rowError } = await db
    .from("giving_stripe_accounts")
    .select("id, church_id, is_primary")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (rowError) {
    if (isMissingFundAccountSchema(rowError)) return null;
    throw new Error("stripe_church_lookup_failed");
  }
  if (!row?.church_id) return null;
  return {
    churchId: row.church_id as string,
    isPrimary: row.is_primary === true,
    accountRowId: row.id as string,
  };
}

/**
 * The account a recorded gift or subscription was charged on. Rows written
 * before migration 0182 carry no account and were all on the primary.
 */
export async function stripeAccountForRecord(
  churchId: string,
  recordAccountId: string | null | undefined,
  db: SupabaseClient = createAdminClient(),
): Promise<string | null> {
  if (recordAccountId) return recordAccountId;
  const { data } = await db
    .from("churches")
    .select("stripe_account_id")
    .eq("id", churchId)
    .maybeSingle();
  return (data?.stripe_account_id as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Donor customers per account
// ---------------------------------------------------------------------------

/**
 * The donor's Stripe Customer on one account, or null.
 *
 * On the primary account, the pre-0182 `giving_donors.stripe_customer_id` is
 * still honoured so a donor's existing customer and saved card keep working.
 */
export async function getDonorStripeCustomer(
  input: { donorId: string; churchId: string; stripeAccountId: string; isPrimary: boolean },
  db: SupabaseClient = createAdminClient(),
): Promise<string | null> {
  const { data, error } = await db
    .from("giving_donor_stripe_customers")
    .select("stripe_customer_id")
    .eq("donor_id", input.donorId)
    .eq("church_id", input.churchId)
    .eq("stripe_account_id", input.stripeAccountId)
    .maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;
  if (error && !isMissingFundAccountSchema(error)) throw new Error("donor_customer_lookup_failed");

  if (!input.isPrimary) return null;
  const { data: donor } = await db
    .from("giving_donors")
    .select("stripe_customer_id")
    .eq("id", input.donorId)
    .eq("church_id", input.churchId)
    .maybeSingle();
  return (donor?.stripe_customer_id as string | null) ?? null;
}

/** Records a donor's Customer on one account. Best effort on a pre-0182 database. */
export async function saveDonorStripeCustomer(
  input: {
    donorId: string;
    churchId: string;
    stripeAccountId: string;
    stripeCustomerId: string;
    isPrimary: boolean;
  },
  db: SupabaseClient = createAdminClient(),
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("giving_donor_stripe_customers").upsert(
    {
      donor_id: input.donorId,
      church_id: input.churchId,
      stripe_account_id: input.stripeAccountId,
      stripe_customer_id: input.stripeCustomerId,
      updated_at: now,
    },
    { onConflict: "donor_id,stripe_account_id" },
  );
  if (error && !isMissingFundAccountSchema(error)) throw new Error("donor_customer_save_failed");

  // Older code paths and app versions still read the donor's own column, which
  // only ever means the primary account.
  if (input.isPrimary) {
    await db
      .from("giving_donors")
      .update({ stripe_customer_id: input.stripeCustomerId, updated_at: now })
      .eq("id", input.donorId)
      .eq("church_id", input.churchId);
  }
}

/** Every connected account a church owns, primary first. */
export async function listChurchStripeAccounts(
  churchId: string,
  db: SupabaseClient = createAdminClient(),
): Promise<GivingStripeAccount[]> {
  const { data, error } = await db
    .from("giving_stripe_accounts")
    .select(GIVING_STRIPE_ACCOUNT_COLUMNS)
    .eq("church_id", churchId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingFundAccountSchema(error)) return [];
    throw new Error("stripe_account_list_failed");
  }
  return (data ?? []).map((row) => mapGivingStripeAccount(row as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Mobile attempts
// ---------------------------------------------------------------------------

/**
 * The account a mobile giving attempt is charged on, fixed the first time it
 * is decided. A resumed attempt must reach the payment intent or subscription
 * it already made, on the account it made it on, even if the fund has since
 * been moved to another account.
 */
export async function pinAttemptStripeAccount(input: {
  db: SupabaseClient;
  table: "giving_donation_attempts" | "giving_recurring_attempts";
  attemptId: string;
  churchId: string;
  fundId: string;
  primaryAccountId: string;
}): Promise<{ ok: true; stripeAccountId: string } | { ok: false; reason: "fund_inactive" | "unavailable" }> {
  const { data: attempt, error } = await input.db
    .from(input.table)
    .select("stripe_account_id")
    .eq("id", input.attemptId)
    .eq("church_id", input.churchId)
    .maybeSingle();
  if (error) {
    return isMissingFundAccountSchema(error)
      ? { ok: true, stripeAccountId: input.primaryAccountId }
      : { ok: false, reason: "unavailable" };
  }
  const pinned = (attempt?.stripe_account_id as string | null | undefined) ?? null;
  if (pinned) return { ok: true, stripeAccountId: pinned };

  let route: FundAccountResolution;
  try {
    route = await resolveFundStripeAccount(input.churchId, input.fundId, input.db, input.primaryAccountId);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!route.ok) {
    return { ok: false, reason: route.reason === "fund_account_not_ready" ? "fund_inactive" : "unavailable" };
  }

  const { error: pinError } = await input.db
    .from(input.table)
    .update({ stripe_account_id: route.stripeAccountId })
    .eq("id", input.attemptId)
    .eq("church_id", input.churchId)
    .is("stripe_account_id", null);
  if (pinError && !isMissingFundAccountSchema(pinError)) return { ok: false, reason: "unavailable" };
  return { ok: true, stripeAccountId: route.stripeAccountId };
}
