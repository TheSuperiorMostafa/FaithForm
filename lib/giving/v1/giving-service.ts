import type { SupabaseClient } from "@supabase/supabase-js";

import { VisitorError } from "@/lib/faithform/errors";
import { getVisitorAccount } from "@/lib/faithform/account";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { resolvePublishedContentRelationshipState } from "@/lib/mobile/v1/discovery-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { donorForAccount } from "@/lib/giving/v1/account-donor";
import { givingChannelsFor, type GivingChannels } from "@/lib/giving/v1/giving-channels";
import {
  attemptStatusForIntent,
  givingProviderConfigured,
  stripeGivingProvider,
  type GivingPaymentProvider,
} from "@/lib/giving/v1/payment-provider";

/**
 * FaithForm's giving surface.
 *
 * Every function here re-derives authorization from the caller's own
 * relationship on every call, and every one of them decides the money — the
 * church, the connected account, the currency, the fund, the amount bounds, the
 * metadata — **server-side**. The only things a client contributes are a fund
 * id, an amount, and an id for its own attempt, and each of those is checked
 * against the church's own rows before it is used.
 *
 * ## What this is not
 *
 * It is not a payment authority. `giving_donations` is written by the Stripe
 * webhook and by nothing else; the attempt rows here are a *log of what a person
 * tried*, and their state is copied from the webhook's conclusion rather than
 * decided alongside it. A native payment sheet reporting success changes nothing
 * in this module.
 */

/** What a client may not decide, expressed as a single currency. */
const CURRENCY = "usd";

/** Bounds on a bound: a fund cannot open the door wider than the platform. */
export const ABSOLUTE_MIN_CENTS = 100;
export const ABSOLUTE_MAX_CENTS = 2_000_000;

export function givingClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

const client = givingClient;

// ---------------------------------------------------------------------------
// Church readiness
// ---------------------------------------------------------------------------

/**
 * Why a church cannot be given to right now.
 *
 * Reported to a phone as a *state*, never as a reason a church would find
 * embarrassing: `not_accepting` covers an incomplete Stripe onboarding, a
 * disabled capability, and a church that turned giving off, and the app says the
 * same sentence for all three.
 */
export type GivingAvailability = "available" | "not_accepting" | "not_found";

export type GivingChurch = {
  churchId: string;
  slug: string;
  name: string;
  stripeAccountId: string;
  currency: string;
  /** Migration 0072. See `givingChannelsFor` for what it decides. */
  applePayDonationsApproved: boolean;
};

export async function resolveGivingChurch(
  slug: string,
  supabase?: SupabaseClient,
): Promise<{ ok: true; church: GivingChurch } | { ok: false; availability: GivingAvailability }> {
  const db = client(supabase);

  let { data, error } = await db
    .from("churches")
    .select(
      "id, name, slug, stripe_account_id, stripe_charges_enabled, apple_pay_donations_approved",
    )
    .eq("slug", slug)
    .maybeSingle();

  // A database that has not had 0072 applied refuses the whole select, which
  // would read as "not found" for every church and switch off giving on both
  // platforms. Asking again without the column keeps giving up, and the church
  // simply reads as unapproved — the state every church is in before 0072.
  if (error && /apple_pay_donations_approved/i.test(error.message)) {
    ({ data, error } = await db
      .from("churches")
      .select("id, name, slug, stripe_account_id, stripe_charges_enabled")
      .eq("slug", slug)
      .maybeSingle());
  }

  // A church that does not exist and a church that is hidden are one answer, as
  // everywhere else in the visitor API.
  if (!data) return { ok: false, availability: "not_found" };

  const stripeAccountId = (data.stripe_account_id as string | null) ?? null;
  if (!stripeAccountId || data.stripe_charges_enabled !== true) {
    return { ok: false, availability: "not_accepting" };
  }

  // The control centre can stop new money moving without touching Stripe.
  if (!(await isChurchFeatureEnabled(data.id as string, "giving"))) {
    return { ok: false, availability: "not_accepting" };
  }

  return {
    ok: true,
    church: {
      churchId: data.id as string,
      slug: data.slug as string,
      name: data.name as string,
      stripeAccountId,
      currency: CURRENCY,
      applePayDonationsApproved:
        (data as { apple_pay_donations_approved?: unknown }).apple_pay_donations_approved ===
        true,
    },
  };
}

// ---------------------------------------------------------------------------
// Published funds
// ---------------------------------------------------------------------------

export type GivingFundDto = {
  fundId: string;
  title: string;
  description: string | null;
  suggestedAmounts: number[];
  minAmountCents: number;
  maxAmountCents: number;
  currency: string;
  publicationVersion: number;
};

export type GivingHomeDto = {
  availability: GivingAvailability;
  churchName: string | null;
  funds: GivingFundDto[];
  /**
   * Whether a recurring gift can be started here, now.
   *
   * True when the church is accepting and has published at least one fund — a
   * subscription is built from the same fund and charged to the same connected
   * account, so it needs nothing a one-time gift does not. Reported rather than
   * inferred by the client so a later reason to withhold recurring has
   * somewhere to live that does not require an app release.
   */
  recurringAvailable: boolean;
  givingVersion: number;
  /**
   * Whether the iPhone app may take this church's gifts with Apple Pay in-app.
   *
   * False unless a platform admin has verified the church's Candid Seal, and
   * always false when the church is not accepting. See `givingChannelsFor`.
   */
  applePayApproved: GivingChannels["applePayApproved"];
  /**
   * The church's public web give page, absolute — where an iPhone sends a
   * giver whose church is not approved. Null whenever `availability` is not
   * `available`.
   */
  webGiveUrl: GivingChannels["webGiveUrl"];
};

export async function getGivingHome(input: {
  userId: string;
  churchSlug: string;
  supabase?: SupabaseClient;
}): Promise<GivingHomeDto> {
  const db = client(input.supabase);
  const resolved = await resolveGivingChurch(input.churchSlug, db);

  if (!resolved.ok) {
    return {
      availability: resolved.availability,
      churchName: null,
      funds: [],
      recurringAvailable: false,
      givingVersion: 0,
      ...givingChannelsFor(null),
    };
  }

  const relationshipState = await resolvePublishedContentRelationshipState(input.userId, input.churchSlug);

  const { data } = await db.rpc("mobile_giving_funds", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
  });

  const funds: GivingFundDto[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    fundId: row.fund_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    suggestedAmounts: ((row.suggested_amounts as number[] | null) ?? []).filter(
      (amount) => Number.isInteger(amount) && amount >= ABSOLUTE_MIN_CENTS,
    ),
    minAmountCents: Number(row.min_amount_cents ?? ABSOLUTE_MIN_CENTS),
    maxAmountCents: Number(row.max_amount_cents ?? ABSOLUTE_MAX_CENTS),
    currency: (row.currency as string) ?? CURRENCY,
    publicationVersion: Number(row.publication_version ?? 1),
  }));

  return {
    availability: "available",
    churchName: resolved.church.name,
    funds,
    // The church is accepting and something is published to give to, which is
    // every condition a subscription needs. Deliberately not "has ever run a
    // recurring gift", which is what this meant before migration 0100: that
    // made the first recurring giver at every church impossible.
    recurringAvailable: funds.length > 0,
    // A single validator over every published fund: any edit to any of them
    // moves it, and a phone's cached giving screen revalidates.
    givingVersion: funds.reduce((total, fund) => total + fund.publicationVersion, funds.length),
    ...givingChannelsFor({
      slug: resolved.church.slug,
      applePayDonationsApproved: resolved.church.applePayDonationsApproved,
    }),
  };
}

// ---------------------------------------------------------------------------
// Starting a donation
// ---------------------------------------------------------------------------

export type StartDonationInput = {
  userId: string;
  churchSlug: string;
  fundId: string;
  amountCents: number;
  /** The client's id for this logical attempt. Its only job is to repeat. */
  clientAttemptId: string;
  supabase?: SupabaseClient;
  provider?: GivingPaymentProvider;
};

export type StartDonationResult =
  | {
      ok: true;
      attemptId: string;
      status: string;
      /** Stripe's own client secret. Ephemeral, never logged, never persisted. */
      clientSecret: string;
      publishableKey: string;
      /**
       * The church's connected account id.
       *
       * Required by Stripe's mobile SDKs to talk to a connected account for a
       * direct charge — `STPAPIClient.stripeAccount` on iOS,
       * `PaymentConfiguration.init(..., stripeAccountId)` on Android. It is an
       * account *identifier*, not a credential: it authorises nothing on its
       * own, and every call carrying it still needs a key.
       */
      stripeAccountId: string;
      merchantName: string;
      amountCents: number;
      currency: string;
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
        | "unavailable";
    };

/**
 * Starts, or resumes, one logical donation attempt.
 *
 * **The same `clientAttemptId` always produces the same payment intent.** That
 * is the whole point: a phone killed mid-sheet, a lost network, a person who
 * pressed Give twice — all of them arrive here again with the id they already
 * used, and all of them get the intent that already exists rather than a second
 * charge.
 *
 * Three layers of that, deliberately:
 *
 *   1. `claim_giving_attempt` is `on conflict do nothing`, so two concurrent
 *      requests produce one row.
 *   2. The row's own `stripe_idempotency_key` goes to Stripe, so this server
 *      retrying cannot produce two intents.
 *   3. `attach_giving_payment_intent` is write-once, so even a bug that created
 *      two intents cannot repoint the attempt at the second.
 */
export async function startDonation(
  input: StartDonationInput,
): Promise<StartDonationResult> {
  const provider = input.provider ?? stripeGivingProvider;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();

  if (!givingProviderConfigured() || !publishableKey) {
    return { ok: false, reason: "unavailable" };
  }

  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = client(input.supabase);
  const resolved = await resolveGivingChurch(input.churchSlug, db);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.availability === "not_found" ? "not_found" : "not_accepting",
    };
  }

  const relationshipState = await resolvePublishedContentRelationshipState(input.userId, input.churchSlug);
  if (relationshipState === "blocked") {
    // The same answer a blocked caller gets everywhere: the church is simply
    // not there. Refusing with a distinct reason would confirm the block.
    return { ok: false, reason: "not_found" };
  }

  // The amount is bounded here as well as in SQL. Not redundancy for its own
  // sake: this is the bound the *platform* imposes, and a church cannot widen it
  // by editing its own fund.
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents < ABSOLUTE_MIN_CENTS ||
    input.amountCents > ABSOLUTE_MAX_CENTS
  ) {
    return { ok: false, reason: "amount_out_of_range" };
  }

  const { data: claimData, error: claimError } = await db.rpc("claim_giving_attempt", {
    p_account_id: account.id,
    p_church_id: resolved.church.churchId,
    p_fund_id: input.fundId,
    p_client_attempt_id: input.clientAttemptId,
    p_amount_cents: input.amountCents,
    p_currency: resolved.church.currency,
  });

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
  const existingIntentId = (claim.stripe_payment_intent_id as string | null) ?? null;

  const fundTitle = await readFundTitle(resolved.church.churchId, input.fundId, db);

  // ---------------------------------------------------------------------
  // Resume, or create.
  //
  // A resumed attempt re-reads the intent from Stripe rather than trusting the
  // stored status: the person may have completed the payment on the sheet that
  // was interrupted, and the honest thing to show is what the provider says now.
  // ---------------------------------------------------------------------
  if (existingIntentId) {
    const existing = await provider.retrieveIntent(
      resolved.church.stripeAccountId,
      existingIntentId,
    );
    if (!existing?.clientSecret) return { ok: false, reason: "unavailable" };

    return {
      ok: true,
      attemptId,
      status: attemptStatusForIntent(existing.status),
      clientSecret: existing.clientSecret,
      publishableKey,
      stripeAccountId: resolved.church.stripeAccountId,
      merchantName: resolved.church.name,
      amountCents,
      currency,
      fundTitle,
    };
  }

  // The donor this gift is from, so the giver can sign in to the donor portal
  // with their address and see it — the same as a recurring gift or a gift on
  // the web. Best effort: an account with no address can still give.
  const donorResult = await donorForAccount({
    userId: input.userId,
    accountId: account.id,
    displayName: account.displayName ?? null,
    churchId: resolved.church.churchId,
    db,
  }).catch(() => null);
  const donor = donorResult?.ok ? donorResult.donor : null;

  let intent;
  try {
    intent = await provider.createIntent({
      stripeAccountId: resolved.church.stripeAccountId,
      amountCents,
      currency,
      idempotencyKey: claim.stripe_idempotency_key as string,
      // Everything the webhook needs to reconcile this back to a church, a fund,
      // an attempt and a donor — and nothing that identifies a person to Stripe
      // beyond what the existing web flow already sends (its donor id, address
      // and name ride in the same keys).
      metadata: {
        church_id: resolved.church.churchId,
        fund_id: input.fundId,
        gift_type: "one_time",
        source: "faithform_mobile",
        faithform_attempt_id: attemptId,
        faithform_account_id: account.id,
        ...(donor
          ? { donor_id: donor.donorId, donor_email: donor.email, donor_name: donor.name ?? "" }
          : {}),
      },
      receiptEmail: null,
    });
  } catch {
    // A provider failure is never a payment outcome. The attempt stays
    // `initiated` and the same client attempt id may be retried.
    return { ok: false, reason: "unavailable" };
  }

  if (!intent.clientSecret) return { ok: false, reason: "unavailable" };

  const { data: attachData } = await db.rpc("attach_giving_payment_intent", {
    p_attempt_id: attemptId,
    p_account_id: account.id,
    p_payment_intent_id: intent.id,
  });
  const attached = ((attachData ?? []) as Record<string, unknown>[])[0];
  if (!attached?.ok) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    attemptId,
    status: attemptStatusForIntent(intent.status),
    clientSecret: intent.clientSecret,
    publishableKey,
    stripeAccountId: resolved.church.stripeAccountId,
    merchantName: resolved.church.name,
    amountCents,
    currency,
    fundTitle,
  };
}

export async function readFundTitle(
  churchId: string,
  fundId: string,
  db: SupabaseClient,
): Promise<string> {
  const { data } = await db
    .from("giving_funds")
    .select("name, mobile_title")
    .eq("id", fundId)
    .eq("church_id", churchId)
    .maybeSingle();
  const title = (data?.mobile_title as string | null) ?? null;
  return title && title.trim() ? title.trim() : ((data?.name as string | null) ?? "Gift");
}

// ---------------------------------------------------------------------------
// What happened
// ---------------------------------------------------------------------------

export type DonationStatusDto = {
  attemptId: string;
  status: string;
  amountCents: number;
  currency: string;
  fundTitle: string;
  /**
   * Whether the server has heard from the webhook.
   *
   * A phone shows a receipt only when this is true. A payment sheet's own
   * success callback sets nothing here, because it is not evidence: it says the
   * SDK finished, not that money moved.
   */
  confirmed: boolean;
  occurredAt: string;
};

export async function getDonationStatus(input: {
  userId: string;
  churchSlug: string;
  attemptId: string;
  supabase?: SupabaseClient;
}): Promise<DonationStatusDto | null> {
  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = client(input.supabase);
  const { data } = await db.rpc("mobile_giving_history", {
    p_account_id: account.id,
    p_church_slug: input.churchSlug,
    p_limit: 50,
    p_before: null,
  });

  const rows = (data ?? []) as Record<string, unknown>[];
  const row = rows.find((item) => item.attempt_id === input.attemptId);
  if (!row) return null;

  return {
    attemptId: row.attempt_id as string,
    status: row.status as string,
    amountCents: Number(row.amount_cents),
    currency: row.currency as string,
    fundTitle: row.fund_title as string,
    confirmed: Boolean(row.receipt_available),
    occurredAt: new Date(row.occurred_at as string).toISOString(),
  };
}

export type GivingHistoryPage = {
  items: DonationStatusDto[];
  nextCursor: string | null;
};

export async function getGivingHistory(input: {
  userId: string;
  churchSlug: string;
  limit: number;
  before: string | null;
  supabase?: SupabaseClient;
}): Promise<GivingHistoryPage> {
  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = client(input.supabase);
  const { data } = await db.rpc("mobile_giving_history", {
    p_account_id: account.id,
    p_church_slug: input.churchSlug,
    p_limit: input.limit + 1,
    p_before: input.before,
  });

  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, input.limit);

  return {
    items: page.map((row) => ({
      attemptId: row.attempt_id as string,
      status: row.status as string,
      amountCents: Number(row.amount_cents),
      currency: row.currency as string,
      fundTitle: row.fund_title as string,
      confirmed: Boolean(row.receipt_available),
      occurredAt: new Date(row.occurred_at as string).toISOString(),
    })),
    nextCursor:
      rows.length > input.limit && page.length > 0
        ? new Date(page[page.length - 1].occurred_at as string).toISOString()
        : null,
  };
}

export type GivingReceiptDto = {
  attemptId: string;
  amountCents: number;
  currency: string;
  fundTitle: string;
  churchName: string;
  paidAt: string;
  giftType: string;
};

/**
 * A receipt, which exists only once a webhook has confirmed the payment.
 *
 * Reached through the *attempt*, which is bound to an account — there is no
 * donation-id path in and no email path in. A donation id from another donor, or
 * from another church, resolves to nothing rather than to a redacted answer.
 */
export async function getGivingReceipt(input: {
  userId: string;
  churchSlug: string;
  attemptId: string;
  supabase?: SupabaseClient;
}): Promise<GivingReceiptDto | null> {
  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const db = client(input.supabase);
  const { data } = await db.rpc("mobile_giving_receipt", {
    p_account_id: account.id,
    p_church_slug: input.churchSlug,
    p_attempt_id: input.attemptId,
  });

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  return {
    attemptId: row.attempt_id as string,
    amountCents: Number(row.amount_cents),
    currency: row.currency as string,
    fundTitle: row.fund_title as string,
    churchName: row.church_name as string,
    paidAt: new Date(row.paid_at as string).toISOString(),
    giftType: (row.gift_type as string) ?? "one_time",
  };
}
