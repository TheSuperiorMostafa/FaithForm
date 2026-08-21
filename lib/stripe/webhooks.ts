import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertGivingDonor } from "@/lib/giving/donors";
import { sendFailedPaymentEmail } from "@/lib/email/giving";
import {
  markChurchDeauthorized,
  syncChurchFromStripeAccount,
} from "@/lib/stripe/connect";
import { getStripe } from "@/lib/stripe/client";
import type { DonationStatus, GiftType, SubscriptionStatus } from "@/types/giving";
import { deliverDonationReceipt } from "@/lib/stripe/receipt-delivery";
import {
  claimStripeEvent,
  completeStripeEvent,
  safeStripeFailure,
  stripeRetryAt,
} from "@/lib/stripe/webhook-state";

async function churchIdForStripeAccount(
  stripeAccountId: string | undefined,
  metadataChurchId?: string | null,
): Promise<string | null> {
  if (!stripeAccountId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (!data?.id) return null;
  if (metadataChurchId && metadataChurchId !== data.id) return null;
  return data.id;
}

async function resolveDonorId(params: {
  churchId: string;
  donorEmail?: string | null;
  donorName?: string | null;
  metadataDonorId?: string | null;
}): Promise<string | null> {
  if (params.metadataDonorId) {
    const admin = createAdminClient();
    const { data: donor } = await admin
      .from("giving_donors")
      .select("id")
      .eq("id", params.metadataDonorId)
      .eq("church_id", params.churchId)
      .maybeSingle();
    if (donor?.id) return donor.id as string;
  }
  if (!params.donorEmail) return null;
  const { donorId } = await upsertGivingDonor({
    churchId: params.churchId,
    email: params.donorEmail,
    name: params.donorName ?? "",
  });
  return donorId;
}

async function fetchChargeFees(
  chargeId: string,
  connectedAccount?: string,
): Promise<{ stripeFeeCents: number | null; netAmountCents: number | null }> {
  try {
    const stripe = getStripe();
    const charge = await stripe.charges.retrieve(
      chargeId,
      { expand: ["balance_transaction"] },
      connectedAccount ? { stripeAccount: connectedAccount } : undefined,
    );
    const bt = charge.balance_transaction;
    if (typeof bt === "object" && bt !== null) {
      return {
        stripeFeeCents: bt.fee,
        netAmountCents: bt.net,
      };
    }
  } catch {
    /* ignore */
  }
  return { stripeFeeCents: null, netAmountCents: null };
}

async function upsertDonation(params: {
  churchId: string;
  amountCents: number;
  currency: string;
  status: DonationStatus;
  giftType: GiftType;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  donorName?: string | null;
  donorEmail?: string | null;
  fundDesignation?: string | null;
  fundId?: string | null;
  donorId?: string | null;
  intendedAmountCents?: number | null;
  feeCovered?: boolean;
  stripeFeeCents?: number | null;
  netAmountCents?: number | null;
  stripeEventCreatedAt: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  let donorId: string | null = null;
  if (params.donorId || params.donorEmail) {
    donorId = await resolveDonorId({
      churchId: params.churchId,
      donorEmail: params.donorEmail,
      donorName: params.donorName,
      metadataDonorId: params.donorId,
    });
  }

  let fundId = params.fundId ?? null;
  if (fundId) {
    const { data: fund } = await admin
      .from("giving_funds")
      .select("id")
      .eq("id", fundId)
      .eq("church_id", params.churchId)
      .maybeSingle();
    if (!fund?.id) fundId = null;
  }

  const row = {
    church_id: params.churchId,
    amount_cents: params.amountCents,
    currency: params.currency,
    status: params.status,
    gift_type: params.giftType,
    stripe_payment_intent_id: params.stripePaymentIntentId ?? null,
    stripe_charge_id: params.stripeChargeId ?? null,
    stripe_invoice_id: params.stripeInvoiceId ?? null,
    stripe_subscription_id: params.stripeSubscriptionId ?? null,
    donor_name: params.donorName ?? null,
    donor_email: params.donorEmail ?? null,
    fund_designation: params.fundDesignation ?? null,
    fund_id: fundId,
    donor_id: donorId,
    intended_amount_cents: params.intendedAmountCents ?? null,
    fee_covered: params.feeCovered ?? false,
    stripe_fee_cents: params.stripeFeeCents ?? null,
    net_amount_cents: params.netAmountCents ?? null,
    stripe_event_created_at: params.stripeEventCreatedAt,
    stripe_object_key: params.stripePaymentIntentId
      ? `payment_intent:${params.stripePaymentIntentId}`
      : params.stripeInvoiceId
        ? `invoice:${params.stripeInvoiceId}`
        : null,
    updated_at: now,
  };

  if (params.stripePaymentIntentId) {
    const { data: existing } = await admin
      .from("giving_donations")
      .select("id")
      .eq("church_id", params.churchId)
      .eq("stripe_payment_intent_id", params.stripePaymentIntentId)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("giving_donations")
        .update(row)
        .eq("id", existing.id)
        .or(
          `stripe_event_created_at.is.null,stripe_event_created_at.lte.${params.stripeEventCreatedAt}`,
        );
      return existing.id as string;
    }
  }

  if (params.stripeInvoiceId) {
    const { data: existing } = await admin
      .from("giving_donations")
      .select("id")
      .eq("church_id", params.churchId)
      .eq("stripe_invoice_id", params.stripeInvoiceId)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from("giving_donations")
        .update(row)
        .eq("id", existing.id)
        .or(
          `stripe_event_created_at.is.null,stripe_event_created_at.lte.${params.stripeEventCreatedAt}`,
        );
      return existing.id as string;
    }
  }

  const { data: inserted, error: insertError } = await admin
    .from("giving_donations")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (insertError?.code === "23505" && row.stripe_object_key) {
    const { data: raced } = await admin
      .from("giving_donations")
      .select("id")
      .eq("church_id", params.churchId)
      .eq("stripe_object_key", row.stripe_object_key)
      .maybeSingle();
    if (raced?.id) {
      await admin
        .from("giving_donations")
        .update(row)
        .eq("id", raced.id)
        .eq("church_id", params.churchId)
        .or(
          `stripe_event_created_at.is.null,stripe_event_created_at.lte.${params.stripeEventCreatedAt}`,
        );
      return raced.id as string;
    }
  }
  if (insertError) throw new Error("donation_reconciliation_failed");

  return (inserted?.id as string | undefined) ?? null;
}

async function maybeSendDonationReceipt(
  donationId: string | null,
  status: DonationStatus,
): Promise<void> {
  if (status === "succeeded" && donationId) {
    await deliverDonationReceipt(donationId);
  }
}

async function upsertSubscription(params: {
  churchId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  amountCents: number;
  currency: string;
  interval: string;
  status: SubscriptionStatus;
  donorName?: string | null;
  donorEmail?: string | null;
  fundDesignation?: string | null;
  fundId?: string | null;
  donorId?: string | null;
  pausedAt?: string | null;
  stripeEventCreatedAt: string;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  let donorId: string | null = null;
  if (params.donorId || params.donorEmail) {
    donorId = await resolveDonorId({
      churchId: params.churchId,
      donorEmail: params.donorEmail,
      donorName: params.donorName,
      metadataDonorId: params.donorId,
    });
  }

  let fundId = params.fundId ?? null;
  if (fundId) {
    const { data: fund } = await admin
      .from("giving_funds")
      .select("id")
      .eq("id", fundId)
      .eq("church_id", params.churchId)
      .maybeSingle();
    if (!fund?.id) fundId = null;
  }

  const { data: existing } = await admin
    .from("giving_subscriptions")
    .select("id")
    .eq("church_id", params.churchId)
    .eq("stripe_subscription_id", params.stripeSubscriptionId)
    .maybeSingle();

  const row = {
    church_id: params.churchId,
    stripe_subscription_id: params.stripeSubscriptionId,
    stripe_customer_id: params.stripeCustomerId,
    amount_cents: params.amountCents,
    currency: params.currency,
    interval: params.interval,
    status: params.status,
    donor_name: params.donorName ?? null,
    donor_email: params.donorEmail ?? null,
    fund_designation: params.fundDesignation ?? null,
    fund_id: fundId,
    donor_id: donorId,
    paused_at: params.pausedAt ?? null,
    updated_at: now,
    stripe_event_created_at: params.stripeEventCreatedAt,
  };

  if (existing?.id) {
    await admin
      .from("giving_subscriptions")
      .update(row)
      .eq("id", existing.id)
      .or(
        `stripe_event_created_at.is.null,stripe_event_created_at.lte.${params.stripeEventCreatedAt}`,
      );
  } else {
    const { error: insertError } = await admin
      .from("giving_subscriptions")
      .insert(row);
    if (insertError?.code === "23505") {
      await admin
        .from("giving_subscriptions")
        .update(row)
        .eq("church_id", params.churchId)
        .eq("stripe_subscription_id", params.stripeSubscriptionId)
        .or(
          `stripe_event_created_at.is.null,stripe_event_created_at.lte.${params.stripeEventCreatedAt}`,
        );
    } else if (insertError) {
      throw new Error("subscription_reconciliation_failed");
    }
  }
}

function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  const allowed: SubscriptionStatus[] = [
    "active",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "paused",
    "trialing",
    "unpaid",
  ];
  return allowed.includes(status as SubscriptionStatus)
    ? (status as SubscriptionStatus)
    : "active";
}

function metaFundId(meta: Stripe.Metadata | null | undefined): string | null {
  return meta?.fund_id || null;
}

function parseIntendedCents(meta: Stripe.Metadata | null | undefined): number | null {
  const raw = meta?.intended_amount_cents;
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function handlePaymentIntent(
  pi: Stripe.PaymentIntent,
  status: DonationStatus,
  connectedAccount?: string,
  eventCreated = 0,
) {
  const churchId = await churchIdForStripeAccount(
    connectedAccount,
    pi.metadata?.church_id,
  );
  if (!churchId) return;

  const giftType =
    pi.metadata?.gift_type === "recurring" ? "recurring" : "one_time";

  const donorEmail = pi.receipt_email ?? pi.metadata?.donor_email ?? null;
  const donorName = pi.metadata?.donor_name || null;

  let stripeFeeCents: number | null = null;
  let netAmountCents: number | null = null;
  let chargeId: string | null = null;

  if (status === "succeeded" && pi.latest_charge) {
    chargeId =
      typeof pi.latest_charge === "string"
        ? pi.latest_charge
        : pi.latest_charge.id;
    const fees = await fetchChargeFees(chargeId, connectedAccount);
    stripeFeeCents = fees.stripeFeeCents;
    netAmountCents = fees.netAmountCents;
  }

  const donationId = await upsertDonation({
    churchId,
    amountCents: pi.amount,
    currency: pi.currency,
    status,
    giftType,
    stripePaymentIntentId: pi.id,
    stripeChargeId: chargeId,
    donorName,
    donorEmail,
    fundDesignation: pi.metadata?.fund_name || pi.metadata?.fund_designation || null,
    fundId: metaFundId(pi.metadata),
    donorId: pi.metadata?.donor_id || null,
    intendedAmountCents: parseIntendedCents(pi.metadata) ?? pi.amount,
    feeCovered: pi.metadata?.cover_fees === "true",
    stripeFeeCents,
    netAmountCents,
    stripeEventCreatedAt: new Date(eventCreated * 1000).toISOString(),
  });

  await maybeSendDonationReceipt(donationId, status);
}

async function handleSubscription(
  sub: Stripe.Subscription,
  connectedAccount?: string,
  eventCreated = 0,
) {
  const churchId = await churchIdForStripeAccount(
    connectedAccount,
    sub.metadata?.church_id,
  );
  if (!churchId) return;

  const item = sub.items.data[0];
  const amountCents = item?.price?.unit_amount ?? 0;
  const interval = item?.price?.recurring?.interval ?? "month";
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";

  let donorEmail: string | null = sub.metadata?.donor_email ?? null;
  let donorName: string | null = sub.metadata?.donor_name ?? null;

  if (connectedAccount && customerId) {
    try {
      const stripe = getStripe();
      const customer = await stripe.customers.retrieve(
        customerId,
        {},
        { stripeAccount: connectedAccount },
      );
      if (!("deleted" in customer && customer.deleted)) {
        donorEmail = donorEmail ?? customer.email ?? null;
        donorName = donorName ?? customer.name ?? null;
      }
    } catch {
      /* ignore */
    }
  }

  const pausedAt =
    sub.pause_collection?.behavior != null
      ? new Date().toISOString()
      : null;

  await upsertSubscription({
    churchId,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    amountCents,
    currency: sub.currency,
    interval,
    status: mapSubscriptionStatus(sub.status),
    donorName,
    donorEmail,
    fundDesignation: sub.metadata?.fund_name || sub.metadata?.fund_designation || null,
    fundId: metaFundId(sub.metadata),
    donorId: sub.metadata?.donor_id || null,
    pausedAt: sub.status === "paused" ? pausedAt : null,
    stripeEventCreatedAt: new Date(eventCreated * 1000).toISOString(),
  });
}

async function handleInvoice(
  invoice: Stripe.Invoice,
  succeeded: boolean,
  connectedAccount?: string,
  eventCreated = 0,
) {
  const invoiceExt = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };

  const churchId = await churchIdForStripeAccount(
    connectedAccount,
    invoice.metadata?.church_id,
  );
  if (!churchId) return;

  const subId =
    typeof invoiceExt.subscription === "string"
      ? invoiceExt.subscription
      : invoiceExt.subscription?.id ?? null;

  let donorName: string | null = null;
  let donorEmail: string | null = invoice.customer_email;
  let fundId: string | null = null;
  let fundDesignation: string | null = null;
  let donorId: string | null = null;
  let intendedAmountCents: number | null = null;

  if (subId && connectedAccount) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(
        subId,
        {},
        { stripeAccount: connectedAccount },
      );
      donorName = sub.metadata?.donor_name ?? null;
      donorEmail = donorEmail ?? sub.metadata?.donor_email ?? null;
      fundId = metaFundId(sub.metadata);
      fundDesignation =
        sub.metadata?.fund_name || sub.metadata?.fund_designation || null;
      donorId = sub.metadata?.donor_id ?? null;
      intendedAmountCents = parseIntendedCents(sub.metadata);
    } catch {
      /* ignore */
    }
  }

  const invoicePi = (
    invoice as Stripe.Invoice & {
      payment_intent?: string | Stripe.PaymentIntent | null;
    }
  ).payment_intent;
  const piId =
    typeof invoicePi === "string" ? invoicePi : invoicePi?.id ?? null;

  const amountCents = invoice.amount_paid || invoice.amount_due;
  const giftType = subId ? "recurring" : "one_time";
  const status = succeeded ? "succeeded" : "failed";

  const donationId = await upsertDonation({
    churchId,
    amountCents,
    currency: invoice.currency,
    status,
    giftType,
    stripePaymentIntentId: piId,
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subId,
    donorEmail,
    donorName,
    fundId,
    fundDesignation,
    donorId,
    intendedAmountCents,
    stripeEventCreatedAt: new Date(eventCreated * 1000).toISOString(),
  });

  await maybeSendDonationReceipt(donationId, status);

  if (!succeeded && subId && donorEmail && connectedAccount) {
    const admin = createAdminClient();
    const { data: church } = await admin
      .from("churches")
      .select("name, slug, giving_primary_color, giving_accent_color")
      .eq("id", churchId)
      .maybeSingle();

    const { data: subRow } = await admin
      .from("giving_subscriptions")
      .select("id, last_dunning_email_at")
      .eq("church_id", churchId)
      .eq("stripe_subscription_id", subId)
      .maybeSingle();

    const lastSent = subRow?.last_dunning_email_at as string | null;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (!lastSent || new Date(lastSent).getTime() < dayAgo) {
      const delivery = await sendFailedPaymentEmail({
        donorEmail,
        donorName,
        churchName: (church?.name as string) ?? "Your church",
        churchSlug: (church?.slug as string) ?? "",
        primaryColor: (church?.giving_primary_color as string | null) ?? null,
        accentColor: (church?.giving_accent_color as string | null) ?? null,
        idempotencyKey: `failed-invoice/${invoice.id}`,
      });

      if (delivery.sent && subRow?.id) {
        await admin
          .from("giving_subscriptions")
          .update({
            last_dunning_email_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", subRow.id);
      }
    }
  }
}

async function processStripeEventEffects(event: Stripe.Event): Promise<void> {
  const connectedAccount =
    typeof event.account === "string" ? event.account : undefined;

  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await syncChurchFromStripeAccount(account);
      break;
    }
    case "capability.updated": {
      const capability = event.data.object as Stripe.Capability;
      if (capability.account) {
        const stripe = getStripe();
        const account = await stripe.accounts.retrieve(
          typeof capability.account === "string"
            ? capability.account
            : capability.account.id,
        );
        await syncChurchFromStripeAccount(account);
      }
      break;
    }
    case "account.application.deauthorized": {
      const app = event.data.object as { account?: string };
      if (app.account) {
        await markChurchDeauthorized(app.account);
      }
      break;
    }
    case "payment_intent.succeeded": {
      await handlePaymentIntent(
        event.data.object as Stripe.PaymentIntent,
        "succeeded",
        connectedAccount,
        event.created,
      );
      break;
    }
    case "payment_intent.payment_failed": {
      await handlePaymentIntent(
        event.data.object as Stripe.PaymentIntent,
        "failed",
        connectedAccount,
        event.created,
      );
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const churchId = await churchIdForStripeAccount(
        connectedAccount,
        charge.metadata?.church_id,
      );
      if (!churchId) break;
      const admin = createAdminClient();
      const piId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (piId) {
        const eventCreatedAt = new Date(event.created * 1000).toISOString();
        await admin
          .from("giving_donations")
          .update({
            status: "refunded",
            updated_at: new Date().toISOString(),
            stripe_event_created_at: eventCreatedAt,
          })
          .eq("church_id", churchId)
          .eq("stripe_payment_intent_id", piId)
          .or(
            `stripe_event_created_at.is.null,stripe_event_created_at.lte.${eventCreatedAt}`,
          );
      }
      break;
    }
    case "invoice.paid": {
      await handleInvoice(
        event.data.object as Stripe.Invoice,
        true,
        connectedAccount,
        event.created,
      );
      break;
    }
    case "invoice.payment_failed": {
      await handleInvoice(
        event.data.object as Stripe.Invoice,
        false,
        connectedAccount,
        event.created,
      );
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await handleSubscription(
        event.data.object as Stripe.Subscription,
        connectedAccount,
        event.created,
      );
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId =
        typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) break;
      const churchId = await churchIdForStripeAccount(connectedAccount);
      if (!churchId) break;
      const admin = createAdminClient();
      const eventCreatedAt = new Date(event.created * 1000).toISOString();
      await admin
        .from("giving_donations")
        .update({
          status: "disputed",
          updated_at: new Date().toISOString(),
          stripe_event_created_at: eventCreatedAt,
        })
        .eq("church_id", churchId)
        .eq("stripe_charge_id", chargeId)
        .or(
          `stripe_event_created_at.is.null,stripe_event_created_at.lte.${eventCreatedAt}`,
        );
      break;
    }
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId =
        typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) break;
      const churchId = await churchIdForStripeAccount(connectedAccount);
      if (!churchId) break;
      const admin = createAdminClient();
      const status = dispute.status === "won" ? "succeeded" : "refunded";
      const eventCreatedAt = new Date(event.created * 1000).toISOString();
      await admin
        .from("giving_donations")
        .update({
          status,
          updated_at: new Date().toISOString(),
          stripe_event_created_at: eventCreatedAt,
        })
        .eq("church_id", churchId)
        .eq("stripe_charge_id", chargeId)
        .or(
          `stripe_event_created_at.is.null,stripe_event_created_at.lte.${eventCreatedAt}`,
        );
      break;
    }
    case "payout.failed": {
      console.warn("[stripe] payout.failed received");
      break;
    }
    default:
      break;
  }

}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const claim = await claimStripeEvent(event.id, event.type);
  if (!claim.claimed) {
    if (claim.status === "processing" || claim.status === "retryable") {
      throw new Error("stripe_event_busy");
    }
    return;
  }
  if (!claim.claimToken) throw new Error("stripe_event_claim_failed");

  try {
    await processStripeEventEffects(event);
    await completeStripeEvent({
      eventId: event.id,
      claimToken: claim.claimToken,
      status: "processed",
    });
  } catch (error) {
    const failure = safeStripeFailure(error);
    const terminal = claim.attempt >= 12;
    await completeStripeEvent({
      eventId: event.id,
      claimToken: claim.claimToken,
      status: terminal ? "terminal" : "retryable",
      failureCategory: failure.category,
      errorCode: failure.code,
      nextRetryAt: terminal ? null : stripeRetryAt(claim.attempt),
    });
    throw error;
  }
}

function getWebhookSigningSecrets(): string[] {
  const fromList = process.env.STRIPE_WEBHOOK_SECRETS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const secrets = [
    ...(fromList ?? []),
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_SNAPSHOT,
    process.env.STRIPE_WEBHOOK_SECRET_THIN,
  ].filter((s): s is string => Boolean(s?.trim()));

  return Array.from(new Set(secrets));
}

export function constructStripeEvent(
  payload: string | Buffer,
  signature: string,
): Stripe.Event {
  const stripe = getStripe();
  const secrets = getWebhookSigningSecrets();

  if (secrets.length === 0) {
    throw new Error(
      "No webhook signing secret configured (set STRIPE_WEBHOOK_SECRET)",
    );
  }

  let lastError: Error | undefined;

  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("Webhook signature verification failed");
}
