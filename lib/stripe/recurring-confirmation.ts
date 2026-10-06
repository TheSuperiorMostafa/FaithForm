import type Stripe from "stripe";
import { invoiceClientSecret } from "@/lib/stripe/invoice-shape";

/** Attach ownership to Stripe's automatic SetupIntent; only its signed event saves the method. */
export async function prepareRecurringConfirmation(stripe: Stripe, subscription: Stripe.Subscription, stripeAccountId: string, idempotencyKey?: string) {
  const setup = typeof subscription.pending_setup_intent === "object" ? subscription.pending_setup_intent : null;
  if (setup?.client_secret && setup.status !== "succeeded") {
    await stripe.setupIntents.update(setup.id, {
      metadata: { church_id: subscription.metadata.church_id, faithform_subscription_id: subscription.id },
    }, { stripeAccount: stripeAccountId, ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}_setup` } : {}) });
    return { clientSecret: setup.client_secret, confirmationType: "setup" as const };
  }
  const invoice = typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  return { clientSecret: invoiceClientSecret(invoice), confirmationType: "payment" as const };
}
