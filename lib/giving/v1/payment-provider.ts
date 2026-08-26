import type Stripe from "stripe";

import { applicationFeeAmount } from "@/lib/stripe/config";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";

/**
 * The one place Faithful talks to Stripe, behind an interface a test can supply.
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

export interface GivingPaymentProvider {
  createIntent(request: MobileIntentRequest): Promise<MobileIntent>;
  retrieveIntent(stripeAccountId: string, intentId: string): Promise<MobileIntent | null>;
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
};

export function givingProviderConfigured(): boolean {
  return isStripeConfigured();
}
