import { createAdminClient } from "@/lib/supabase/admin";
import {
  accountCanTakeGifts,
  isMissingFundAccountSchema,
  listChurchStripeAccounts,
  type GivingStripeAccount,
} from "@/lib/giving/stripe-accounts";

/**
 * The Funds & Banks view: per fund, which Stripe account and which bank its
 * gifts go to, whether it can take gifts, and what was last paid out.
 *
 * Read with the service role, so callers must have checked that the requester
 * is an admin of `churchId`.
 */

export type FundAccountStatus = "active" | "needs_info" | "pending" | "disconnected";

export type FundAccountPayout = {
  stripePayoutId: string;
  amountCents: number;
  currency: string;
  status: "paid" | "pending" | "in_transit" | "canceled" | "failed";
  arrivalDate: string | null;
  failureCode: string | null;
};

export type FundsBankAccount = GivingStripeAccount & {
  displayStatus: FundAccountStatus;
  lastPayout: FundAccountPayout | null;
  recentPayouts: FundAccountPayout[];
  /** Names of active funds whose gifts go to this account. */
  fundNames: string[];
};

export type FundsBankFund = {
  fundId: string;
  name: string;
  isDefault: boolean;
  /** The account this fund's gifts go to now. Null when no account is connected at all. */
  accountRowId: string | null;
  /** An account the fund switches to once it is active. */
  pendingAccountRowId: string | null;
  /** Whether a donor can choose this fund on a giving form right now. */
  givable: boolean;
  /** Succeeded gifts in the last 30 days, in cents. */
  last30DaysCents: number;
};

export type FundsAndBanks = {
  /** False until the church has connected its main Stripe account. */
  mainConnected: boolean;
  /** False on a database without migration 0182; the page then explains. */
  schemaReady: boolean;
  accounts: FundsBankAccount[];
  funds: FundsBankFund[];
};

export function fundAccountStatus(
  account: Pick<GivingStripeAccount, "status" | "requirementsDue" | "chargesEnabled" | "payoutsEnabled">,
): FundAccountStatus {
  if (account.status === "deauthorized") return "disconnected";
  if (account.requirementsDue.length > 0 || account.status === "restricted") return "needs_info";
  if (accountCanTakeGifts(account)) return "active";
  return "pending";
}

function mapPayout(row: Record<string, unknown>): FundAccountPayout {
  return {
    stripePayoutId: row.stripe_payout_id as string,
    amountCents: Number(row.amount_cents ?? 0),
    currency: (row.currency as string) ?? "usd",
    status: row.status as FundAccountPayout["status"],
    arrivalDate: (row.arrival_date as string | null) ?? null,
    failureCode: (row.failure_code as string | null) ?? null,
  };
}

export async function getFundsAndBanks(churchId: string): Promise<FundsAndBanks> {
  const admin = createAdminClient();

  const { data: church, error: churchError } = await admin
    .from("churches")
    .select(
      "stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_onboarding_status, stripe_requirements_due, created_at",
    )
    .eq("id", churchId)
    .maybeSingle();
  if (churchError) throw new Error("funds and banks church read failed");
  const mainAccountId = (church?.stripe_account_id as string | null) ?? null;

  const { data: fundRows, error: fundError } = await admin
    .from("giving_funds")
    .select("id, name, is_default, sort_order, giving_stripe_account_id, pending_giving_stripe_account_id")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (fundError) {
    if (isMissingFundAccountSchema(fundError)) {
      return { mainConnected: Boolean(mainAccountId), schemaReady: false, accounts: [], funds: [] };
    }
    throw new Error("funds and banks fund read failed");
  }

  let accounts = await listChurchStripeAccounts(churchId, admin);

  // A church connected before 0182's backfill could have no primary row yet if
  // the mirror write failed. The churches columns are still the truth for it.
  if (mainAccountId && !accounts.some((a) => a.stripeAccountId === mainAccountId)) {
    const status = church?.stripe_onboarding_status as string;
    accounts = [
      {
        id: `main:${mainAccountId}`,
        churchId,
        stripeAccountId: mainAccountId,
        label: "Main account",
        isPrimary: true,
        status:
          status === "active" || status === "restricted" || status === "deauthorized" ? status : "pending",
        detailsSubmitted: church?.stripe_details_submitted === true,
        chargesEnabled: church?.stripe_charges_enabled === true,
        payoutsEnabled: church?.stripe_payouts_enabled === true,
        requirementsDue: Array.isArray(church?.stripe_requirements_due)
          ? (church?.stripe_requirements_due as string[])
          : [],
        payoutSchedule: null,
        bankName: null,
        bankLast4: null,
        createdAt: (church?.created_at as string) ?? new Date(0).toISOString(),
      },
      ...accounts,
    ];
  }

  const primary = accounts.find((a) => a.stripeAccountId === mainAccountId) ?? null;

  const { data: payoutRows, error: payoutError } = await admin
    .from("giving_payouts")
    .select("stripe_account_id, stripe_payout_id, amount_cents, currency, status, arrival_date, failure_code")
    .eq("church_id", churchId)
    .order("arrival_date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (payoutError && !isMissingFundAccountSchema(payoutError)) {
    throw new Error("funds and banks payout read failed");
  }
  const payoutsByAccount = new Map<string, FundAccountPayout[]>();
  for (const row of (payoutRows ?? []) as Record<string, unknown>[]) {
    const key = row.stripe_account_id as string;
    const list = payoutsByAccount.get(key) ?? [];
    if (list.length < 10) list.push(mapPayout(row));
    payoutsByAccount.set(key, list);
  }

  // 30-day totals per fund. Bounded: a church with more than 10,000 gifts in a
  // month reads a partial total rather than stalling the page.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const totals = new Map<string, number>();
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await admin
      .from("giving_donations")
      .select("fund_id, amount_cents")
      .eq("church_id", churchId)
      .eq("status", "succeeded")
      .gte("created_at", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error("funds and banks gift totals read failed");
    for (const row of data ?? []) {
      if (!row.fund_id) continue;
      totals.set(row.fund_id as string, (totals.get(row.fund_id as string) ?? 0) + Number(row.amount_cents ?? 0));
    }
    if ((data ?? []).length < 1000) break;
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const funds: FundsBankFund[] = (fundRows ?? []).map((row) => {
    const own = (row.giving_stripe_account_id as string | null) ?? null;
    const effective = own ? accountById.get(own) ?? null : primary;
    const givable = own
      ? Boolean(effective && (effective.isPrimary ? accountCanTakeGifts(effective) || church?.stripe_charges_enabled === true : accountCanTakeGifts(effective)))
      : church?.stripe_charges_enabled === true;
    return {
      fundId: row.id as string,
      name: row.name as string,
      isDefault: row.is_default === true,
      accountRowId: effective?.id ?? null,
      pendingAccountRowId: (row.pending_giving_stripe_account_id as string | null) ?? null,
      givable,
      last30DaysCents: totals.get(row.id as string) ?? 0,
    };
  });

  return {
    mainConnected: Boolean(mainAccountId),
    schemaReady: true,
    accounts: accounts.map((account) => {
      const payouts = payoutsByAccount.get(account.stripeAccountId) ?? [];
      return {
        ...account,
        displayStatus: fundAccountStatus(account),
        lastPayout: payouts[0] ?? null,
        recentPayouts: payouts,
        fundNames: funds.filter((f) => f.accountRowId === account.id).map((f) => f.name),
      };
    }),
    funds,
  };
}
