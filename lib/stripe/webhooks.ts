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

async function isEventProcessed(eventId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("stripe_webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  return Boolean(data?.event_id);
}

async function markEventProcessed(eventId: string, eventType: string) {
  const admin = createAdminClient();
  await admin.from("stripe_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
  });
}

async function churchIdForStripeAccount(
  stripeAccountId: string | undefined,
  metadataChurchId?: string | null,
): Promise<string | null> {
  if (metadataChurchId) return metadataChurchId;
  if (!stripeAccountId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  return data?.id ?? null;
}

async function resolveDonorId(params: {
  churchId: string;
  donorEmail?: string | null;
  donorName?: string | null;
  metadataDonorId?: string | null;
}): Promise<string | null> {
  if (params.metadataDonorId) return params.metadataDonorId;
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
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  let donorId = params.donorId ?? null;
  if (!donorId && params.donorEmail) {
    donorId = await resolveDonorId({
      churchId: params.churchId,
      donorEmail: params.donorEmail,
      donorName: params.donorName,
    });
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
    fund_id: params.fundId ?? null,
    donor_id: donorId,
    intended_amount_cents: params.intendedAmountCents ?? null,
    fee_covered: params.feeCovered ?? false,
    stripe_fee_cents: params.stripeFeeCents ?? null,
    net_amount_cents: params.netAmountCents ?? null,
    updated_at: now,
  };

  if (params.stripePaymentIntentId) {
    const { data: existing } = await admin
      .from("giving_donations")
      .select("id")
      .eq("stripe_payment_intent_id", params.stripePaymentIntentId)
      .maybeSingle();

    if (existing?.id) {
      await admin.from("giving_donations").update(row).eq("id", existing.id);
      return;
    }
  }

  await admin.from("giving_donations").insert(row);
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
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  let donorId = params.donorId ?? null;
  if (!donorId && params.donorEmail) {
    donorId = await resolveDonorId({
      churchId: params.churchId,
      donorEmail: params.donorEmail,
      donorName: params.donorName,
      metadataDonorId: params.donorId,
    });
  }

  const { data: existing } = await admin
    .from("giving_subscriptions")
    .select("id")
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
    fund_id: params.fundId ?? null,
    donor_id: donorId,
    paused_at: params.pausedAt ?? null,
    updated_at: now,
  };

  if (existing?.id) {
    await admin.from("giving_subscriptions").update(row).eq("id", existing.id);
  } else {
    await admin.from("giving_subscriptions").insert(row);
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

  await upsertDonation({
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
  });
}

async function handleSubscription(
  sub: Stripe.Subscription,
  connectedAccount?: string,
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
  });
}

async function handleInvoice(
  invoice: Stripe.Invoice,
  succeeded: boolean,
  connectedAccount?: string,
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

  await upsertDonation({
    churchId,
    amountCents: invoice.amount_paid || invoice.amount_due,
    currency: invoice.currency,
    status: succeeded ? "succeeded" : "failed",
    giftType: subId ? "recurring" : "one_time",
    stripePaymentIntentId: piId,
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subId,
    donorEmail,
    donorName,
    fundId,
    fundDesignation,
    donorId,
  });

  if (!succeeded && subId && donorEmail && connectedAccount) {
    const admin = createAdminClient();
    const { data: church } = await admin
      .from("churches")
      .select("name, slug")
      .eq("id", churchId)
      .maybeSingle();

    const { data: subRow } = await admin
      .from("giving_subscriptions")
      .select("id, last_dunning_email_at")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();

    const lastSent = subRow?.last_dunning_email_at as string | null;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (!lastSent || new Date(lastSent).getTime() < dayAgo) {
      await sendFailedPaymentEmail({
        donorEmail,
        donorName,
        churchName: (church?.name as string) ?? "Your church",
        churchSlug: (church?.slug as string) ?? "",
      });

      if (subRow?.id) {
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

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  if (await isEventProcessed(event.id)) {
    return;
  }

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
      );
      break;
    }
    case "payment_intent.payment_failed": {
      await handlePaymentIntent(
        event.data.object as Stripe.PaymentIntent,
        "failed",
        connectedAccount,
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
        await admin
          .from("giving_donations")
          .update({ status: "refunded", updated_at: new Date().toISOString() })
          .eq("stripe_payment_intent_id", piId);
      }
      break;
    }
    case "invoice.paid": {
      await handleInvoice(event.data.object as Stripe.Invoice, true, connectedAccount);
      break;
    }
    case "invoice.payment_failed": {
      await handleInvoice(event.data.object as Stripe.Invoice, false, connectedAccount);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await handleSubscription(
        event.data.object as Stripe.Subscription,
        connectedAccount,
      );
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId =
        typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) break;
      const admin = createAdminClient();
      await admin
        .from("giving_donations")
        .update({ status: "disputed", updated_at: new Date().toISOString() })
        .eq("stripe_charge_id", chargeId);
      break;
    }
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const chargeId =
        typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (!chargeId) break;
      const admin = createAdminClient();
      const status = dispute.status === "won" ? "succeeded" : "refunded";
      await admin
        .from("giving_donations")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("stripe_charge_id", chargeId);
      break;
    }
    case "payout.failed": {
      console.warn("[stripe] payout.failed", event.id, connectedAccount);
      break;
    }
    default:
      break;
  }

  await markEventProcessed(event.id, event.type);
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
