import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { fetchInvoicePaymentIntentId } from "@/lib/stripe/invoice-shape";

export function stripeChargeFees(charge: Stripe.Charge, currency: string, amountCents: number) {
  const transaction = charge.balance_transaction;
  if (
    !charge.paid || charge.amount_captured !== amountCents || charge.currency !== currency ||
    !transaction || typeof transaction === "string" || transaction.currency !== currency ||
    transaction.amount !== amountCents
  ) return null;

  return { stripe_fee_cents: transaction.fee, net_amount_cents: transaction.net };
}

type GiftNeedingFees = {
  id: string;
  church_id: string;
  currency: string;
  amount_cents: number;
  stripe_charge_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  updated_at: string;
  churches: { stripe_account_id: string };
};

async function readGiftFees(stripe: Stripe, gift: GiftNeedingFees) {
  const stripeAccount = gift.churches.stripe_account_id;
  const options = { stripeAccount, timeout: 4000, maxNetworkRetries: 0 };
  if (gift.stripe_charge_id) {
    const charge = await stripe.charges.retrieve(gift.stripe_charge_id, { expand: ["balance_transaction"] }, options);
    return stripeChargeFees(charge, gift.currency, gift.amount_cents);
  }

  const intentId = gift.stripe_payment_intent_id ?? (gift.stripe_invoice_id
    ? await fetchInvoicePaymentIntentId(stripe, gift.stripe_invoice_id, stripeAccount, options)
    : null);
  if (!intentId) return null;

  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge.balance_transaction"] }, options);
  const charge = intent.latest_charge;
  if (intent.status !== "succeeded" || !charge || typeof charge === "string") return null;
  return stripeChargeFees(charge, gift.currency, gift.amount_cents);
}

/** Recovers fees missed at webhook time, including donations from older webhook versions. */
export async function reconcileDonationFees() {
  if (!isStripeConfigured()) return { feeChecks: 0, feeErrors: 0 };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("giving_donations")
    .select("id, church_id, amount_cents, currency, stripe_charge_id, stripe_payment_intent_id, stripe_invoice_id, updated_at, churches!inner(stripe_account_id)")
    .eq("status", "succeeded")
    .gt("amount_cents", 0)
    .is("net_amount_cents", null)
    .not("churches.stripe_account_id", "is", null)
    .or("stripe_charge_id.not.is.null,stripe_payment_intent_id.not.is.null,stripe_invoice_id.not.is.null")
    .order("updated_at")
    .order("id")
    .limit(20)
    .returns<GiftNeedingFees[]>();
  if (error) throw new Error("donation_fee_lookup_failed");

  const stripe = getStripe();
  const results = await Promise.allSettled((data ?? []).map(async (gift) => {
    let fees: ReturnType<typeof stripeChargeFees> = null;
    let lookupFailed = false;
    try {
      fees = await readGiftFees(stripe, gift);
    } catch {
      lookupFailed = true;
    }

    // Move unresolved rows to the end of the queue so an unavailable Stripe
    // record cannot block older gifts. Leave any concurrent webhook write alone.
    const { error: writeError } = await admin
      .from("giving_donations")
      .update({ ...fees, updated_at: new Date().toISOString() })
      .eq("id", gift.id)
      .eq("church_id", gift.church_id)
      .eq("status", "succeeded")
      .eq("updated_at", gift.updated_at)
      .is("net_amount_cents", null);
    if (lookupFailed || writeError) throw new Error("donation_fee_reconciliation_failed");
  }));

  return { feeChecks: results.length, feeErrors: results.filter((result) => result.status === "rejected").length };
}
