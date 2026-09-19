import type Stripe from "stripe";
import { isChurchFeatureEmailEnabled } from "@/lib/features/access";
import { nextWeekdayAnchorUnix } from "@/lib/giving/branding";
import { chargeCentsWithFeeCoverage } from "@/lib/giving/fees";
import { applicationFeeAmount } from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";
import {
  fetchInvoicePaymentIntentId,
  invoiceClientSecret,
  invoicePaymentIntentId,
} from "@/lib/stripe/invoice-shape";

/**
 * Whether to ask Stripe to email the donor its own receipt (`receipt_email`).
 *
 * Stripe sends that receipt from the church's account, in live mode only, and
 * knows nothing of FaithForm's switches, so it is withheld here when a platform
 * admin turns Giving's emails off. Withholding it costs the webhook nothing: a
 * one-time gift also carries the donor's email in `metadata.donor_email`, which
 * the webhook falls back to, and a recurring gift's comes from the invoice's
 * `customer_email` and the subscription's metadata.
 */
function stripeReceiptsEnabled(churchId: string): Promise<boolean> {
  return isChurchFeatureEmailEnabled(churchId, "giving");
}

export type GivingPaymentMetadata = {
  churchId: string;
  donorId: string;
  donorEmail: string;
  donorName: string;
  fundId: string;
  fundSlug: string;
  fundName: string;
  giftType: "one_time" | "recurring";
  intendedAmountCents: number;
  coverFees: boolean;
};

function buildMetadata(meta: GivingPaymentMetadata): Record<string, string> {
  return {
    church_id: meta.churchId,
    donor_id: meta.donorId,
    donor_email: meta.donorEmail,
    donor_name: meta.donorName,
    fund_id: meta.fundId,
    fund_slug: meta.fundSlug,
    fund_name: meta.fundName,
    fund_designation: meta.fundName,
    gift_type: meta.giftType,
    intended_amount_cents: String(meta.intendedAmountCents),
    cover_fees: meta.coverFees ? "true" : "false",
  };
}

export type CreatePaymentIntentInput = {
  stripeAccountId: string;
  churchId: string;
  amountCents: number;
  intendedAmountCents: number;
  coverFees: boolean;
  currency?: string;
  donorEmail: string;
  donorName: string;
  donorId: string;
  fundId: string;
  fundSlug: string;
  fundName: string;
};

export async function createConnectedPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  const fee = applicationFeeAmount();
  const chargeAmount = input.coverFees
    ? chargeCentsWithFeeCoverage(input.intendedAmountCents)
    : input.amountCents;

  const metadata = buildMetadata({
    churchId: input.churchId,
    donorId: input.donorId,
    donorEmail: input.donorEmail,
    donorName: input.donorName,
    fundId: input.fundId,
    fundSlug: input.fundSlug,
    fundName: input.fundName,
    giftType: "one_time",
    intendedAmountCents: input.intendedAmountCents,
    coverFees: input.coverFees,
  });

  const stripeReceipt = await stripeReceiptsEnabled(input.churchId);

  return stripe.paymentIntents.create(
    {
      amount: chargeAmount,
      currency: input.currency ?? "usd",
      automatic_payment_methods: { enabled: true },
      ...(stripeReceipt ? { receipt_email: input.donorEmail } : {}),
      metadata,
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
    },
    { stripeAccount: input.stripeAccountId },
  );
}

export type CreateSubscriptionInput = {
  stripeAccountId: string;
  churchId: string;
  amountCents: number;
  intendedAmountCents: number;
  coverFees: boolean;
  interval: "week" | "month" | "year";
  donorEmail: string;
  donorName: string;
  donorId: string;
  stripeCustomerId?: string | null;
  fundId: string;
  fundSlug: string;
  fundName: string;
  billingDayOfMonth?: number;
  billingDayOfWeek?: number;
};

export async function createConnectedSubscription(
  input: CreateSubscriptionInput,
): Promise<{
  subscription: Stripe.Subscription;
  clientSecret: string | null;
  customerId: string;
}> {
  const stripe = getStripe();
  const chargeAmount = input.coverFees
    ? chargeCentsWithFeeCoverage(input.intendedAmountCents)
    : input.amountCents;

  const metadata = buildMetadata({
    churchId: input.churchId,
    donorId: input.donorId,
    donorEmail: input.donorEmail,
    donorName: input.donorName,
    fundId: input.fundId,
    fundSlug: input.fundSlug,
    fundName: input.fundName,
    giftType: "recurring",
    intendedAmountCents: input.intendedAmountCents,
    coverFees: input.coverFees,
  });

  let customerId = input.stripeCustomerId ?? null;

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        email: input.donorEmail,
        name: input.donorName,
        metadata: {
          church_id: input.churchId,
          donor_id: input.donorId,
        },
      },
      { stripeAccount: input.stripeAccountId },
    );
    customerId = customer.id;
  }

  const price = await stripe.prices.create(
    {
      unit_amount: chargeAmount,
      currency: "usd",
      recurring: { interval: input.interval },
      product_data: {
        name: `Recurring gift — ${input.fundName}`,
      },
    },
    { stripeAccount: input.stripeAccountId },
  );

  const subscriptionMetadata: Record<string, string> = {
    ...metadata,
  };
  if (input.billingDayOfMonth) {
    subscriptionMetadata.billing_day_of_month = String(input.billingDayOfMonth);
  }
  if (input.billingDayOfWeek !== undefined) {
    subscriptionMetadata.billing_day_of_week = String(input.billingDayOfWeek);
  }

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: price.id }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
    },
    // The client secret for the first payment. `latest_invoice.payment_intent`
    // can't be expanded from API version 2025-03-31.basil on, and this SDK pins
    // a later version, so asking for it fails the whole request.
    expand: ["latest_invoice.confirmation_secret"],
    metadata: subscriptionMetadata,
  };

  if (input.interval === "month" && input.billingDayOfMonth) {
    subscriptionParams.billing_cycle_anchor_config = {
      day_of_month: input.billingDayOfMonth,
    };
  } else if (input.interval === "week" && input.billingDayOfWeek !== undefined) {
    subscriptionParams.billing_cycle_anchor = nextWeekdayAnchorUnix(input.billingDayOfWeek);
  }

  const subscription = await stripe.subscriptions.create(subscriptionParams, {
    stripeAccount: input.stripeAccountId,
  });

  const invoice =
    typeof subscription.latest_invoice === "object"
      ? subscription.latest_invoice
      : null;

  if (invoice && (await stripeReceiptsEnabled(input.churchId))) {
    await addFirstPaymentReceiptEmail(
      stripe,
      invoice,
      input.donorEmail,
      input.stripeAccountId,
    );
  }

  return { subscription, clientSecret: invoiceClientSecret(invoice), customerId };
}

/**
 * Asks Stripe to email its own receipt for a recurring gift's first payment,
 * as it does for a one-time gift. Renewals never had this.
 *
 * Best effort. The subscription already exists by now, so failing here would
 * show the donor an error for a gift they could still complete.
 */
async function addFirstPaymentReceiptEmail(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  donorEmail: string,
  stripeAccountId: string,
): Promise<void> {
  try {
    const paymentIntentId =
      invoicePaymentIntentId(invoice) ??
      (await fetchInvoicePaymentIntentId(stripe, invoice.id, stripeAccountId));
    if (!paymentIntentId) return;

    await stripe.paymentIntents.update(
      paymentIntentId,
      { receipt_email: donorEmail },
      { stripeAccount: stripeAccountId },
    );
  } catch {
    /* the donor still gets FaithForm's receipt from the webhook */
  }
}

export async function createBillingPortalSession(
  stripeAccountId: string,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create(
    {
      customer: customerId,
      return_url: returnUrl,
    },
    { stripeAccount: stripeAccountId },
  );
  return session.url;
}

export async function createSetupIntent(
  stripeAccountId: string,
  customerId: string,
): Promise<string> {
  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.create(
    {
      customer: customerId,
      payment_method_types: ["card"],
    },
    { stripeAccount: stripeAccountId },
  );
  if (!setupIntent.client_secret) {
    throw new Error("No setup intent client secret");
  }
  return setupIntent.client_secret;
}

export async function updateSubscriptionAmount(
  stripeAccountId: string,
  subscriptionId: string,
  newAmountCents: number,
  fundName: string,
): Promise<void> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(
    subscriptionId,
    {},
    { stripeAccount: stripeAccountId },
  );
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error("Subscription has no items");

  const price = await stripe.prices.create(
    {
      unit_amount: newAmountCents,
      currency: sub.currency,
      recurring: {
        interval: sub.items.data[0]?.price?.recurring?.interval ?? "month",
      },
      product_data: { name: `Recurring gift — ${fundName}` },
    },
    { stripeAccount: stripeAccountId },
  );

  await stripe.subscriptions.update(
    subscriptionId,
    {
      items: [{ id: itemId, price: price.id }],
      proration_behavior: "none",
    },
    { stripeAccount: stripeAccountId },
  );
}

export async function pauseSubscription(
  stripeAccountId: string,
  subscriptionId: string,
): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(
    subscriptionId,
    { pause_collection: { behavior: "void" } },
    { stripeAccount: stripeAccountId },
  );
}

export async function resumeSubscription(
  stripeAccountId: string,
  subscriptionId: string,
): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(
    subscriptionId,
    { pause_collection: null as unknown as undefined },
    { stripeAccount: stripeAccountId },
  );
}

export async function cancelSubscription(
  stripeAccountId: string,
  subscriptionId: string,
): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.cancel(
    subscriptionId,
    {},
    { stripeAccount: stripeAccountId },
  );
}

export async function refundPaymentIntent(
  stripeAccountId: string,
  paymentIntentId: string,
  reason?: string,
): Promise<void> {
  const stripe = getStripe();
  await stripe.refunds.create(
    { payment_intent: paymentIntentId, reason: "requested_by_customer" },
    { stripeAccount: stripeAccountId },
  );
  if (reason) {
    const admin = await import("@/lib/supabase/admin").then((m) =>
      m.createAdminClient(),
    );
    await admin
      .from("giving_donations")
      .update({
        refund_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", paymentIntentId);
  }
}

export async function listConnectedPayouts(
  stripeAccountId: string,
  limit = 25,
): Promise<Stripe.Payout[]> {
  const stripe = getStripe();
  const payouts = await stripe.payouts.list(
    { limit },
    { stripeAccount: stripeAccountId },
  );
  return payouts.data;
}
