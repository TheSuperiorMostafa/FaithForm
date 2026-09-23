import type { SupabaseClient } from "@supabase/supabase-js";

import { VisitorError } from "@/lib/faithform/errors";
import { getVisitorAccount } from "@/lib/faithform/account";
import { getAuthUsersByIds } from "@/lib/auth/auth-users";
import { upsertGivingDonor } from "@/lib/giving/donors";
import { resolvePublishedContentRelationshipState } from "@/lib/mobile/v1/discovery-service";
import {
  ABSOLUTE_MAX_CENTS,
  ABSOLUTE_MIN_CENTS,
  givingClient,
  readFundTitle,
  resolveGivingChurch,
} from "@/lib/giving/v1/giving-service";
import {
  givingProviderConfigured,
  stripeGivingProvider,
  type GivingPaymentProvider,
} from "@/lib/giving/v1/payment-provider";

/**
 * Recurring giving, from a phone.
 *
 * ## What this adds to `giving-service.ts`
 *
 * One thing: a subscription instead of a payment intent. Every other decision —
 * which church, which connected account, which currency, whether the fund is
 * published, what the platform's amount bounds are — is re-derived here exactly
 * as it is there, from the church's own rows, and never from the client.
 *
 * ## Why a duplicate matters more here
 *
 * A duplicated one-time gift charges a person twice and somebody asks for a
 * refund. A duplicated subscription charges them twice **every month**, and the
 * second one is invisible until a bank statement says so. So the same
 * `clientAttemptId` discipline applies, with the same three layers:
 *
 *   1. `claim_giving_recurring_attempt` is `on conflict do nothing`, so two
 *      concurrent requests produce one row.
 *   2. The row's own `stripe_idempotency_key` goes to Stripe, so this server
 *      retrying cannot produce two subscriptions.
 *   3. `attach_giving_subscription` is write-once, so even a bug that created
 *      two cannot repoint the attempt at the second.
 *
 * ## What it is not
 *
 * It is not a payment authority, and it is not a subscription authority.
 * `giving_subscriptions` is written by the Stripe webhook and by nothing here.
 * The rows this module writes record what a person *asked to start*; what
 * exists is whatever the webhook last reconciled.
 */

const CURRENCY = "usd";

/** The cadences `giving_subscriptions.interval` already allows. */
export type GivingInterval = "week" | "month" | "year";

export type StartRecurringGiftInput = {
  userId: string;
  churchSlug: string;
  fundId: string;
  amountCents: number;
  interval: GivingInterval;
  clientAttemptId: string;
  supabase?: SupabaseClient;
  provider?: GivingPaymentProvider;
};

export type StartRecurringGiftResult =
  | {
      ok: true;
      attemptId: string;
      /**
       * The first invoice's secret.
       *
       * Null when the attempt is being resumed and its first invoice is already
       * paid — the gift is live and there is nothing left to confirm.
       */
      clientSecret: string | null;
      publishableKey: string;
      stripeAccountId: string;
      merchantName: string;
      amountCents: number;
      currency: string;
      interval: GivingInterval;
      fundTitle: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_accepting"
        | "fund_not_found"
        | "fund_inactive"
        | "fund_not_published"
        | "amount_out_of_range"
        | "attempt_church_mismatch"
        | "no_email"
        | "unavailable";
    };

/**
 * Starts, or resumes starting, one recurring gift.
 *
 * ## Why an email is required, and where it comes from
 *
 * A church's donor is keyed `(church_id, email)`, and a Stripe customer needs
 * one. The address used is the **signed-in account's own**, read from Auth — a
 * client cannot send one, which is what stops a person attaching their gift to
 * somebody else's donor record.
 *
 * The account is then linked to that donor through `link_giving_donor`, which
 * is first-write-wins: an account that already gave here keeps the donor it
 * already had, even if the email on the account changed since.
 */
export async function startRecurringGift(
  input: StartRecurringGiftInput,
): Promise<StartRecurringGiftResult> {
  const provider = input.provider ?? stripeGivingProvider;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();

  if (!givingProviderConfigured() || !publishableKey) {
    return { ok: false, reason: "unavailable" };
  }

  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = givingClient(input.supabase);
  const resolved = await resolveGivingChurch(input.churchSlug, db);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.availability === "not_found" ? "not_found" : "not_accepting",
    };
  }

  const relationshipState = await resolvePublishedContentRelationshipState(
    input.userId,
    input.churchSlug,
  );
  if (relationshipState === "blocked") {
    // The same answer a blocked caller gets everywhere: the church is simply
    // not there. A distinct reason would confirm the block.
    return { ok: false, reason: "not_found" };
  }

  // The platform's own bound, checked before the fund's. A church cannot widen
  // it by editing its own fund, and a recurring gift cannot slip past it by
  // being small once a month.
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents < ABSOLUTE_MIN_CENTS ||
    input.amountCents > ABSOLUTE_MAX_CENTS
  ) {
    return { ok: false, reason: "amount_out_of_range" };
  }

  const { data: claimData, error: claimError } = await db.rpc(
    "claim_giving_recurring_attempt",
    {
      p_account_id: account.id,
      p_church_id: resolved.church.churchId,
      p_fund_id: input.fundId,
      p_client_attempt_id: input.clientAttemptId,
      p_amount_cents: input.amountCents,
      p_interval: input.interval,
      p_currency: resolved.church.currency,
    },
  );

  if (claimError) return { ok: false, reason: "unavailable" };
  const claim = ((claimData ?? []) as Record<string, unknown>[])[0];
  if (!claim?.ok) {
    const reason = (claim?.reason as string) ?? "unavailable";
    switch (reason) {
      case "fund_not_found":
      case "fund_inactive":
      case "fund_not_published":
      case "amount_out_of_range":
      case "attempt_church_mismatch":
        return { ok: false, reason };
      default:
        return { ok: false, reason: "unavailable" };
    }
  }

  const attemptId = claim.attempt_id as string;
  const amountCents = Number(claim.amount_cents);
  const currency = (claim.currency as string) ?? CURRENCY;
  const interval = (claim.interval as GivingInterval) ?? input.interval;
  const existingSubscriptionId = (claim.stripe_subscription_id as string | null) ?? null;

  const fundTitle = await readFundTitle(resolved.church.churchId, input.fundId, db);

  // ---------------------------------------------------------------------
  // Resume.
  //
  // A resumed attempt re-reads the subscription from Stripe rather than
  // trusting anything stored: the person may have completed the first payment
  // on the sheet that was interrupted, and the honest thing is what the
  // provider says now.
  // ---------------------------------------------------------------------
  if (existingSubscriptionId) {
    const existing = await provider.retrieveSubscription(
      resolved.church.stripeAccountId,
      existingSubscriptionId,
    );
    if (!existing) return { ok: false, reason: "unavailable" };

    return {
      ok: true,
      attemptId,
      clientSecret: existing.clientSecret,
      publishableKey,
      stripeAccountId: resolved.church.stripeAccountId,
      merchantName: resolved.church.name,
      amountCents,
      currency,
      interval,
      fundTitle,
    };
  }

  // ---------------------------------------------------------------------
  // The donor this account gives as.
  // ---------------------------------------------------------------------
  const email = await accountEmail(input.userId);
  if (!email) return { ok: false, reason: "no_email" };

  const { donorId, stripeCustomerId } = await upsertGivingDonor({
    churchId: resolved.church.churchId,
    email,
    name: account.displayName ?? email,
  });

  const { data: linkData } = await db.rpc("link_giving_donor", {
    p_account_id: account.id,
    p_church_id: resolved.church.churchId,
    p_donor_id: donorId,
  });
  const link = ((linkData ?? []) as Record<string, unknown>[])[0];
  if (!link?.ok) return { ok: false, reason: "unavailable" };

  // First-write-wins: an account that already gave here keeps the donor it had.
  // The gift is attached to *that* donor, so one person's giving at one church
  // stays one record however many addresses their account has worn.
  const effectiveDonorId = (link.donor_id as string) ?? donorId;
  const donor = await readDonor(effectiveDonorId, resolved.church.churchId, db);
  if (!donor) return { ok: false, reason: "unavailable" };

  let customerId: string;
  let subscription;
  try {
    customerId = await provider.ensureCustomer({
      stripeAccountId: resolved.church.stripeAccountId,
      existingCustomerId:
        effectiveDonorId === donorId ? (stripeCustomerId ?? donor.stripeCustomerId) : donor.stripeCustomerId,
      email: donor.email,
      name: donor.name,
      metadata: {
        church_id: resolved.church.churchId,
        donor_id: effectiveDonorId,
      },
      idempotencyKey: claim.stripe_idempotency_key as string,
    });

    subscription = await provider.createSubscription({
      stripeAccountId: resolved.church.stripeAccountId,
      customerId,
      amountCents,
      currency,
      interval,
      productName: `Recurring gift — ${fundTitle}`,
      idempotencyKey: claim.stripe_idempotency_key as string,
      // What the webhook needs to reconcile this onto `giving_subscriptions`.
      // The key names are the web flow's, unchanged, because the webhook reads
      // both paths' events with one reader and a second vocabulary would be a
      // second thing to keep in step.
      metadata: {
        church_id: resolved.church.churchId,
        donor_id: effectiveDonorId,
        donor_email: donor.email,
        donor_name: donor.name ?? "",
        fund_id: input.fundId,
        fund_name: fundTitle,
        fund_designation: fundTitle,
        gift_type: "recurring",
        intended_amount_cents: String(amountCents),
        cover_fees: "false",
        source: "faithform_mobile",
        faithform_attempt_id: attemptId,
        faithform_account_id: account.id,
      },
    });
  } catch {
    // A provider failure is never a subscription outcome. The attempt stays
    // unattached and the same client attempt id may be retried.
    return { ok: false, reason: "unavailable" };
  }

  // Stripe's customer id belongs on the donor, so the donor portal and a later
  // gift both find it. Best effort: the subscription already exists, and
  // failing here would show an error for a gift that is about to work.
  if (customerId !== donor.stripeCustomerId) {
    await db
      .from("giving_donors")
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("id", effectiveDonorId)
      .eq("church_id", resolved.church.churchId);
  }

  const { data: attachData } = await db.rpc("attach_giving_subscription", {
    p_attempt_id: attemptId,
    p_account_id: account.id,
    p_subscription_id: subscription.id,
  });
  const attached = ((attachData ?? []) as Record<string, unknown>[])[0];
  if (!attached?.ok) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    attemptId,
    clientSecret: subscription.clientSecret,
    publishableKey,
    stripeAccountId: resolved.church.stripeAccountId,
    merchantName: resolved.church.name,
    amountCents,
    currency,
    interval,
    fundTitle,
  };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type RecurringGiftDto = {
  subscriptionId: string;
  fundTitle: string;
  amountCents: number;
  currency: string;
  interval: GivingInterval;
  status: string;
  startedAt: string;
};

/**
 * A person's own recurring gifts at one church.
 *
 * Every field comes from `mobile_giving_recurring`, which resolves ownership
 * through `giving_donor_links` and returns no provider identifier at all. There
 * is no path in here that takes a subscription id from a client.
 */
export async function listRecurringGifts(input: {
  userId: string;
  churchSlug: string;
  supabase?: SupabaseClient;
}): Promise<RecurringGiftDto[]> {
  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = givingClient(input.supabase);
  const { data } = await db.rpc("mobile_giving_recurring", {
    p_account_id: account.id,
    p_church_slug: input.churchSlug,
  });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    subscriptionId: row.subscription_id as string,
    fundTitle: row.fund_title as string,
    amountCents: Number(row.amount_cents),
    currency: (row.currency as string) ?? CURRENCY,
    interval: row.interval as GivingInterval,
    status: row.status as string,
    startedAt: new Date(row.started_at as string).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------

export type CancelRecurringGiftResult =
  | { ok: true; subscriptionId: string; stopped: boolean }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * Stops one recurring gift.
 *
 * ## Why this does not check whether giving is switched on
 *
 * Because turning Giving off must never trap somebody in a recurring charge.
 * The donor portal made the same call for the same reason: a church can stop
 * taking new money, but a person must always be able to stop giving it. The
 * feature flag gates `startRecurringGift`, and only that.
 *
 * ## What a client may say
 *
 * One FaithForm row id, which `mobile_giving_recurring_owner` resolves only for
 * the account that owns it. A subscription id from another donor, or from
 * another church, resolves to nothing rather than to a refusal that would
 * confirm it exists.
 */
export async function cancelRecurringGift(input: {
  userId: string;
  churchSlug: string;
  subscriptionId: string;
  supabase?: SupabaseClient;
  provider?: GivingPaymentProvider;
}): Promise<CancelRecurringGiftResult> {
  const provider = input.provider ?? stripeGivingProvider;
  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = givingClient(input.supabase);
  const { data, error } = await db.rpc("mobile_giving_recurring_owner", {
    p_account_id: account.id,
    p_church_slug: input.churchSlug,
    p_subscription_id: input.subscriptionId,
  });

  if (error) return { ok: false, reason: "unavailable" };
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.ok) return { ok: false, reason: "not_found" };

  const stripeSubscriptionId = (row.stripe_subscription_id as string | null) ?? null;
  if (!stripeSubscriptionId) return { ok: false, reason: "unavailable" };

  const { data: church } = await db
    .from("churches")
    .select("stripe_account_id")
    .eq("id", row.church_id as string)
    .maybeSingle();

  const stripeAccountId = (church?.stripe_account_id as string | null) ?? null;
  if (!stripeAccountId) return { ok: false, reason: "unavailable" };

  const stopped = await provider.cancelSubscription(stripeAccountId, stripeSubscriptionId);
  if (!stopped) return { ok: false, reason: "unavailable" };

  // The row itself is left alone. `customer.subscription.deleted` follows and
  // the webhook writes `canceled`, as it does for the web portal — one writer,
  // one ordering guard, one truth.
  return { ok: true, subscriptionId: input.subscriptionId, stopped: true };
}

// ---------------------------------------------------------------------------
// Deleting an account
// ---------------------------------------------------------------------------

/**
 * Stops every recurring gift an account still has, at every church.
 *
 * ## Why account deletion has to do this explicitly
 *
 * Because no foreign key can cancel a Stripe subscription. Deleting an account
 * removes the rows that *point* at the gift — the donor link, the attempt — and
 * leaves the subscription charging a card every month, now with no way for the
 * person to see it in the app and no account to sign in with. That is the worst
 * outcome this feature could produce, and it is the default one unless
 * something does this.
 *
 * ## Best effort, and why that is acceptable here
 *
 * Reported rather than thrown. A church whose Stripe account is unreachable
 * must not block the deletion itself: Apple's guideline 5.1.1(v) and
 * /account-deletion both promise the account goes, and a provider outage is not
 * a reason to break that promise. The count comes back so the run can log what
 * it could not stop, and the church's own donor portal remains the way out for
 * anything left — as it already is for every gift started on the web.
 *
 * Must be called **before** the donor links are revoked, because the links are
 * how a gift is found.
 */
export async function stopAllRecurringGiftsForAccount(input: {
  accountId: string;
  supabase?: SupabaseClient;
  provider?: GivingPaymentProvider;
}): Promise<{ stopped: number; failed: number }> {
  const provider = input.provider ?? stripeGivingProvider;
  const db = givingClient(input.supabase);

  if (!givingProviderConfigured()) return { stopped: 0, failed: 0 };

  const { data: links } = await db
    .from("giving_donor_links")
    .select("donor_id, church_id")
    .eq("account_id", input.accountId)
    .is("revoked_at", null);

  const rows = (links ?? []) as { donor_id: string; church_id: string }[];
  if (rows.length === 0) return { stopped: 0, failed: 0 };

  let stopped = 0;
  let failed = 0;

  for (const link of rows) {
    const { data: subs } = await db
      .from("giving_subscriptions")
      .select("stripe_subscription_id")
      .eq("church_id", link.church_id)
      .eq("donor_id", link.donor_id)
      // The states that still charge. A cancelled gift needs nothing, and an
      // incomplete one expires on its own.
      .in("status", ["active", "trialing", "past_due", "paused", "unpaid"]);

    const subscriptions = (subs ?? []) as { stripe_subscription_id: string | null }[];
    if (subscriptions.length === 0) continue;

    const { data: church } = await db
      .from("churches")
      .select("stripe_account_id")
      .eq("id", link.church_id)
      .maybeSingle();

    const stripeAccountId = (church?.stripe_account_id as string | null) ?? null;
    if (!stripeAccountId) {
      failed += subscriptions.length;
      continue;
    }

    for (const subscription of subscriptions) {
      if (!subscription.stripe_subscription_id) {
        failed += 1;
        continue;
      }
      const ok = await provider
        .cancelSubscription(stripeAccountId, subscription.stripe_subscription_id)
        .catch(() => false);
      if (ok) stopped += 1;
      else failed += 1;
    }
  }

  return { stopped, failed };
}

// ---------------------------------------------------------------------------
// Reading what a client never sends
// ---------------------------------------------------------------------------

/** The signed-in account's own address, from Auth. Never a client value. */
async function accountEmail(userId: string): Promise<string | null> {
  const users = await getAuthUsersByIds([userId]);
  const email = users.get(userId)?.email ?? null;
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

async function readDonor(
  donorId: string,
  churchId: string,
  db: SupabaseClient,
): Promise<{ email: string; name: string | null; stripeCustomerId: string | null } | null> {
  const { data } = await db
    .from("giving_donors")
    .select("email, name, stripe_customer_id")
    .eq("id", donorId)
    .eq("church_id", churchId)
    .maybeSingle();

  if (!data?.email) return null;
  return {
    email: data.email as string,
    name: (data.name as string | null) ?? null,
    stripeCustomerId: (data.stripe_customer_id as string | null) ?? null,
  };
}
