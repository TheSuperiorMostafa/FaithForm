/**
 * Reads an invoice in either of Stripe's two shapes.
 *
 * API version 2025-03-31.basil moved the two invoice fields recurring giving
 * depends on:
 *
 *   invoice.subscription   → invoice.parent.subscription_details.subscription
 *   invoice.payment_intent → invoice.payments.data[].payment.payment_intent
 *
 * and stopped `latest_invoice.payment_intent` being expandable, in favour of
 * `latest_invoice.confirmation_secret`.
 *
 * The SDK pins 2026-05-27.dahlia, so everything this app fetches arrives in the
 * new shape. A webhook payload is different: Stripe renders it in the API
 * version of the endpoint that receives it, and an endpoint can be pinned to an
 * older version than the SDK. So both shapes are read. Reading only the old
 * one fails quietly rather than loudly: every recurring gift is recorded as a
 * one-time gift with no fund, beside a second donation row for the same money.
 *
 * Pure, so tests/unit/stripe-invoice-shape.test.ts can pin both shapes with
 * fixtures and no network.
 */

type IdOrObject = string | { id: string } | null | undefined;

type InvoicePaymentShape = {
  is_default?: boolean;
  /** `open`, `paid` or `canceled`. */
  status?: string;
  payment?: {
    /** Payment intents carry this; other Stripe payment types do not. */
    payment_intent?: IdOrObject;
    type?: string;
  } | null;
};

/** The fields read here, from both shapes. A `Stripe.Invoice` satisfies it. */
export type InvoiceShape = {
  /** 2025-03-31.basil and later. */
  parent?: {
    subscription_details?: { subscription?: IdOrObject } | null;
  } | null;
  /**
   * 2025-03-31.basil and later. Includable, so never in a webhook payload:
   * only present when expanded or when built from the invoice payments list.
   */
  payments?: { data?: readonly InvoicePaymentShape[] } | null;
  /** 2025-03-31.basil and later. Includable, like `payments`. */
  confirmation_secret?: { client_secret?: string | null } | null;
  /** Before 2025-03-31.basil. */
  subscription?: IdOrObject;
  /** Before 2025-03-31.basil. An object when expanded. */
  payment_intent?:
    | string
    | { id: string; client_secret?: string | null }
    | null;
};

function idOf(value: IdOrObject): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
}

/** The subscription that generated this invoice, if one did. */
export function invoiceSubscriptionId(
  invoice: InvoiceShape | null | undefined,
): string | null {
  if (!invoice) return null;
  return (
    idOf(invoice.parent?.subscription_details?.subscription) ??
    idOf(invoice.subscription)
  );
}

/**
 * The payment intent that paid, or is trying to pay, this invoice.
 *
 * An invoice can carry several payments since basil. The one that paid wins;
 * failing that, the default one, which is the payment intent Stripe made when
 * it finalized the invoice and keeps retrying after a failure.
 */
export function invoicePaymentIntentId(
  invoice: InvoiceShape | null | undefined,
): string | null {
  if (!invoice) return null;

  const payments = (invoice.payments?.data ?? []).filter((payment) =>
    idOf(payment.payment?.payment_intent),
  );
  const chosen =
    payments.find((payment) => payment.status === "paid") ??
    payments.find((payment) => payment.is_default) ??
    payments[0];

  return (
    idOf(chosen?.payment?.payment_intent) ?? idOf(invoice.payment_intent)
  );
}

/** The client secret the browser confirms an invoice's first payment with. */
export function invoiceClientSecret(
  invoice: InvoiceShape | null | undefined,
): string | null {
  if (!invoice) return null;

  const legacy = invoice.payment_intent;
  return (
    invoice.confirmation_secret?.client_secret ||
    (legacy && typeof legacy === "object" ? legacy.client_secret : null) ||
    null
  );
}

/** Just the Stripe call `fetchInvoicePaymentIntentId` makes, so a test can stand in. */
export type InvoicePaymentLister = {
  invoicePayments: {
    list(
      params: { invoice: string; limit?: number },
      options: { stripeAccount: string },
    ): PromiseLike<{ data: readonly InvoicePaymentShape[] }>;
  };
};

/**
 * Asks Stripe which payment intent belongs to an invoice, for when the invoice
 * in hand does not say: a basil-or-later webhook payload never includes
 * `payments`. Errors propagate on purpose; the caller decides whether a
 * missing answer is worth failing over.
 */
export async function fetchInvoicePaymentIntentId(
  stripe: InvoicePaymentLister,
  invoiceId: string,
  stripeAccount: string,
): Promise<string | null> {
  const payments = await stripe.invoicePayments.list(
    { invoice: invoiceId, limit: 10 },
    { stripeAccount },
  );
  return invoicePaymentIntentId({ payments });
}
