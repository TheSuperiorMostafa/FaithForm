import type Stripe from "stripe";

import { applicationFeeAmount } from "@/lib/stripe/config";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { invoiceClientSecret } from "@/lib/stripe/invoice-shape";

/**
 * The one place FaithForm talks to Stripe, behind an interface a test can supply.
 *
 * ## Why an interface at all
 *
 * Everything interesting about mobile giving — which account is charged, whether
 * an amount is allowed, what a retry does, what a phone is told — is decidable
 * without a network. Putting Stripe behind this seam means those decisions are
 * tested against real behaviour rather than mocked away, and it means **no test
 * in this repository claims anything about live Stripe**, because no test can
 * reach it.
 *
 * ## Why it is thin
 *
 * It creates one payment intent and reads one back. It is not a second payment
 * authority: `lib/stripe/giving.ts` remains the module that knows how a
 * connected charge is shaped, and the web flow is unchanged.
 */

export type MobileIntentRequest = {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  /** Derived server-side from the attempt row. Never a client value. */
  idempotencyKey: string;
  metadata: Record<string, string>;
  receiptEmail: string | null;
};

export type MobileIntent = {
  id: string;
  clientSecret: string | null;
  status: string;
};

export type MobileSubscriptionRequest = {
  stripeAccountId: string;
  customerId: string;
  amountCents: number;
  currency: string;
  interval: "week" | "month" | "year";
  /** Shown on the church's own Stripe dashboard and on the donor's statement. */
  productName: string;
  /** Derived server-side from the attempt row. Never a client value. */
  idempotencyKey: string;
  metadata: Record<string, string>;
};

export type MobileSubscription = {
  id: string;
  /**
   * The first invoice's secret, which the payment sheet confirms.
   *
   * Null once the subscription needs no payment — an already-paid first invoice
   * on a resumed attempt, most often. A caller that gets null has a live
   * subscription and nothing left to confirm.
   */
  clientSecret: string | null;
  status: string;
};

export interface GivingPaymentProvider {
  createIntent(request: MobileIntentRequest): Promise<MobileIntent>;
  retrieveIntent(stripeAccountId: string, intentId: string): Promise<MobileIntent | null>;
  ensureCustomer(request: {
    stripeAccountId: string;
    existingCustomerId: string | null;
    email: string;
    name: string | null;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<string>;
  createSubscription(request: MobileSubscriptionRequest): Promise<MobileSubscription>;
  retrieveSubscription(
    stripeAccountId: string,
    subscriptionId: string,
  ): Promise<MobileSubscription | null>;
  cancelSubscription(stripeAccountId: string, subscriptionId: string): Promise<boolean>;
}

/**
 * Maps Stripe's payment-intent status onto the attempt state machine.
 *
 * Exported because it is the only translation between a provider's vocabulary
 * and this application's, and both the webhook path and the status route must
 * agree on it. Two copies of this mapping would eventually disagree, and the
 * disagreement would be a phone showing "succeeded" for a gift that did not.
 */
export function attemptStatusForIntent(status: string): string {
  switch (status) {
    case "requires_payment_method":
    case "requires_confirmation":
      return "initiated";
    case "requires_action":
      return "requires_action";
    case "processing":
      return "processing";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "cancelled";
    default:
      // An unrecognised status is not a guess. `initiated` is the state that
      // makes a client keep asking rather than believe anything.
      return "initiated";
  }
}

function toMobileIntent(intent: Stripe.PaymentIntent): MobileIntent {
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    status: intent.status,
  };
}

function toMobileSubscription(subscription: Stripe.Subscription): MobileSubscription {
  const invoice =
    typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;

  return {
    id: subscription.id,
    clientSecret: invoiceClientSecret(invoice),
    status: subscription.status,
  };
}

/**
 * Maps Stripe's subscription status onto what a phone is allowed to see.
 *
 * `incomplete` — a subscription whose first invoice has not been paid — is
 * deliberately reported as `incomplete` rather than promoted to anything
 * hopeful. The client shows a gift as started only for the statuses the
 * contract's `RecurringGiftStatus` lists, and that one is not among them.
 */
export function recurringStatusIsLive(status: string): boolean {
  return ["active", "trialing", "past_due", "paused", "unpaid"].includes(status);
}

/** The real provider. Direct charges on the church's own connected account. */
export const stripeGivingProvider: GivingPaymentProvider = {
  async createIntent(request) {
    const stripe = getStripe();
    const fee = applicationFeeAmount();

    const intent = await stripe.paymentIntents.create(
      {
        amount: request.amountCents,
        currency: request.currency,
        // Lets the church's own Stripe dashboard settings decide which methods
        // are offered, rather than this app hard-coding a list it would then
        // have to keep in step with a payments product.
        automatic_payment_methods: { enabled: true },
        ...(request.receiptEmail ? { receipt_email: request.receiptEmail } : {}),
        metadata: request.metadata,
        ...(fee > 0 ? { application_fee_amount: fee } : {}),
      },
      {
        stripeAccount: request.stripeAccountId,
        // **The duplicate-charge defence at the provider.** The key is derived
        // from the attempt row, so this server retrying — a timeout, a cold
        // start, a redeploy mid-request — returns the first intent rather than
        // creating a second.
        idempotencyKey: request.idempotencyKey,
      },
    );

    return toMobileIntent(intent);
  },

  async retrieveIntent(stripeAccountId, intentId) {
    const stripe = getStripe();
    try {
      const intent = await stripe.paymentIntents.retrieve(
        intentId,
        {},
        { stripeAccount: stripeAccountId },
      );
      return toMobileIntent(intent);
    } catch {
      // A provider that cannot be reached is not evidence about a payment.
      return null;
    }
  },

  async ensureCustomer(request) {
    if (request.existingCustomerId) return request.existingCustomerId;

    const stripe = getStripe();
    const customer = await stripe.customers.create(
      {
        email: request.email,
        ...(request.name ? { name: request.name } : {}),
        metadata: request.metadata,
      },
      {
        stripeAccount: request.stripeAccountId,
        // The attempt's key, suffixed. A retried create reuses the customer it
        // already made rather than leaving a second one behind on the church's
        // account for every network blip.
        idempotencyKey: `${request.idempotencyKey}_cus`,
      },
    );
    return customer.id;
  },

  async createSubscription(request) {
    const stripe = getStripe();

    // An inline price rather than a catalogue one: the amount is the person's
    // own, and a church's product list is not the place to accumulate one entry
    // per giver. Keyed off the attempt for the same reason the subscription is.
    const price = await stripe.prices.create(
      {
        unit_amount: request.amountCents,
        currency: request.currency,
        recurring: { interval: request.interval },
        product_data: { name: request.productName },
      },
      {
        stripeAccount: request.stripeAccountId,
        idempotencyKey: `${request.idempotencyKey}_price`,
      },
    );

    const subscription = await stripe.subscriptions.create(
      {
        customer: request.customerId,
        items: [{ price: price.id }],
        // The subscription exists before anything is paid, and the first
        // invoice is what the payment sheet confirms. Confirming it also saves
        // the method, which is what makes every renewal work without asking
        // again.
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        // `latest_invoice.payment_intent` cannot be expanded from API version
        // 2025-03-31.basil on, and this SDK pins a later one, so asking for it
        // fails the whole request. The web flow learned this first.
        expand: ["latest_invoice.confirmation_secret"],
        metadata: request.metadata,
      },
      {
        stripeAccount: request.stripeAccountId,
        // **The duplicate-subscription defence at the provider.** Derived from
        // the attempt row, so this server retrying — a timeout, a cold start, a
        // redeploy mid-request — returns the first subscription rather than
        // starting a second monthly charge.
        idempotencyKey: request.idempotencyKey,
      },
    );

    return toMobileSubscription(subscription);
  },

  async retrieveSubscription(stripeAccountId, subscriptionId) {
    const stripe = getStripe();
    try {
      const subscription = await stripe.subscriptions.retrieve(
        subscriptionId,
        { expand: ["latest_invoice.confirmation_secret"] },
        { stripeAccount: stripeAccountId },
      );
      return toMobileSubscription(subscription);
    } catch {
      return null;
    }
  },

  async cancelSubscription(stripeAccountId, subscriptionId) {
    const stripe = getStripe();
    try {
      await stripe.subscriptions.cancel(
        subscriptionId,
        {},
        { stripeAccount: stripeAccountId },
      );
      return true;
    } catch {
      // Reported as a failure so the person is told to try again, rather than
      // shown a gift that says "stopped" and charges them next month.
      return false;
    }
  },
};

export function givingProviderConfigured(): boolean {
  return isStripeConfigured();
}
