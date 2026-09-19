import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchInvoicePaymentIntentId,
  invoiceClientSecret,
  invoicePaymentIntentId,
  invoiceSubscriptionId,
  type InvoicePaymentLister,
} from "@/lib/stripe/invoice-shape";

// ---------------------------------------------------------------------------
// Fixtures: the same recurring-gift invoice as Stripe renders it before and
// after API version 2025-03-31.basil. Trimmed to the fields the helpers read,
// plus enough neighbours to look like the real payload.
// ---------------------------------------------------------------------------

/** An `invoice.paid` payload from an endpoint pinned before basil. */
const legacyPaidInvoice = {
  id: "in_legacy",
  object: "invoice",
  billing_reason: "subscription_cycle",
  customer_email: "donor@example.org",
  subscription: "sub_legacy",
  payment_intent: "pi_legacy",
  amount_paid: 5000,
};

/** A pre-basil invoice with `subscription` and `payment_intent` expanded. */
const legacyExpandedInvoice = {
  id: "in_legacy_expanded",
  object: "invoice",
  subscription: { id: "sub_legacy", object: "subscription" },
  payment_intent: {
    id: "pi_legacy_expanded",
    object: "payment_intent",
    client_secret: "pi_legacy_expanded_secret_abc",
  },
};

/**
 * An `invoice.paid` payload from a basil-or-later endpoint (dahlia included).
 * `payments` is includable, so a webhook never carries it: the payment intent
 * is simply absent, and the subscription has moved under `parent`.
 */
const dahliaWebhookInvoice = {
  id: "in_dahlia",
  object: "invoice",
  billing_reason: "subscription_cycle",
  customer_email: "donor@example.org",
  parent: {
    type: "subscription_details",
    quote_details: null,
    subscription_details: {
      subscription: "sub_dahlia",
      metadata: { church_id: "church-a", fund_id: "fund-a" },
    },
  },
  amount_paid: 5000,
};

/** The same dahlia invoice fetched with `expand: ["payments"]`. */
const dahliaExpandedInvoice = {
  ...dahliaWebhookInvoice,
  payments: {
    object: "list",
    has_more: false,
    data: [
      {
        id: "inpay_1",
        object: "invoice_payment",
        is_default: true,
        status: "paid",
        payment: { type: "payment_intent", payment_intent: "pi_dahlia" },
      },
    ],
  },
};

/** `subscriptions.create` with `expand: ["latest_invoice.confirmation_secret"]`. */
const dahliaFirstInvoice = {
  id: "in_first",
  object: "invoice",
  billing_reason: "subscription_create",
  parent: {
    type: "subscription_details",
    quote_details: null,
    subscription_details: { subscription: "sub_new", metadata: {} },
  },
  confirmation_secret: {
    client_secret: "pi_first_secret_xyz",
    type: "payment_intent",
  },
};

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

test("the subscription is read from the pre-basil top-level field", () => {
  assert.equal(invoiceSubscriptionId(legacyPaidInvoice), "sub_legacy");
  assert.equal(invoiceSubscriptionId(legacyExpandedInvoice), "sub_legacy");
});

test("the subscription is read from parent.subscription_details on basil and later", () => {
  assert.equal(invoiceSubscriptionId(dahliaWebhookInvoice), "sub_dahlia");
  assert.equal(
    invoiceSubscriptionId({
      parent: {
        subscription_details: {
          subscription: { id: "sub_expanded" },
        },
      },
    }),
    "sub_expanded",
  );
});

test("an invoice no subscription generated has no subscription in either shape", () => {
  assert.equal(invoiceSubscriptionId({ subscription: null }), null);
  assert.equal(invoiceSubscriptionId({ parent: null }), null);
  // A quote's invoice: the parent exists, but it isn't a subscription.
  assert.equal(
    invoiceSubscriptionId({
      parent: { subscription_details: null },
    }),
    null,
  );
  assert.equal(invoiceSubscriptionId(null), null);
  assert.equal(invoiceSubscriptionId(undefined), null);
});

// ---------------------------------------------------------------------------
// Payment intent
// ---------------------------------------------------------------------------

test("the payment intent is read from the pre-basil top-level field, id or object", () => {
  assert.equal(invoicePaymentIntentId(legacyPaidInvoice), "pi_legacy");
  assert.equal(invoicePaymentIntentId(legacyExpandedInvoice), "pi_legacy_expanded");
});

test("a basil-or-later webhook payload names no payment intent, so the caller must ask", () => {
  // This null is the whole reason fetchInvoicePaymentIntentId exists: before
  // this fix the webhook treated it as "no payment intent" and wrote a second
  // donation row beside the one payment_intent.succeeded had already written.
  assert.equal(invoicePaymentIntentId(dahliaWebhookInvoice), null);
});

test("the payment intent is read from invoice.payments when it is present", () => {
  assert.equal(invoicePaymentIntentId(dahliaExpandedInvoice), "pi_dahlia");
  assert.equal(
    invoicePaymentIntentId({
      payments: {
        data: [
          { is_default: true, status: "paid", payment: { payment_intent: { id: "pi_obj" } } },
        ],
      },
    }),
    "pi_obj",
  );
});

test("of several payments, the paid one wins, then the default one", () => {
  const paidIsNotDefault = {
    payments: {
      data: [
        { is_default: true, status: "canceled", payment: { payment_intent: "pi_default" } },
        { is_default: false, status: "paid", payment: { payment_intent: "pi_paid" } },
      ],
    },
  };
  assert.equal(invoicePaymentIntentId(paidIsNotDefault), "pi_paid");

  // A failed invoice: nothing is paid yet, and Stripe keeps retrying the
  // default payment's intent.
  const failed = {
    payments: {
      data: [
        { is_default: false, status: "canceled", payment: { payment_intent: "pi_old" } },
        { is_default: true, status: "open", payment: { payment_intent: "pi_retrying" } },
      ],
    },
  };
  assert.equal(invoicePaymentIntentId(failed), "pi_retrying");
});

test("payments that are not payment intents are ignored", () => {
  const outOfBand = {
    payments: {
      data: [
        { is_default: true, status: "paid", payment: { type: "payment_record" } },
      ],
    },
  };
  assert.equal(invoicePaymentIntentId(outOfBand), null);
  assert.equal(invoicePaymentIntentId({ payments: { data: [] } }), null);
  assert.equal(invoicePaymentIntentId({ payment_intent: null }), null);
  assert.equal(invoicePaymentIntentId(null), null);
});

// ---------------------------------------------------------------------------
// Client secret for the first payment
// ---------------------------------------------------------------------------

test("the first payment's client secret comes from confirmation_secret on basil and later", () => {
  assert.equal(invoiceClientSecret(dahliaFirstInvoice), "pi_first_secret_xyz");
});

test("the client secret still reads from an expanded pre-basil payment intent", () => {
  assert.equal(
    invoiceClientSecret(legacyExpandedInvoice),
    "pi_legacy_expanded_secret_abc",
  );
});

test("no client secret when there is nothing to confirm", () => {
  // Unexpanded, or a $0 first invoice with no payment to take.
  assert.equal(invoiceClientSecret(legacyPaidInvoice), null);
  assert.equal(invoiceClientSecret({ confirmation_secret: null }), null);
  assert.equal(invoiceClientSecret(null), null);
});

// ---------------------------------------------------------------------------
// Asking Stripe when the payload doesn't say
// ---------------------------------------------------------------------------

function lister(
  data: { is_default?: boolean; status?: string; payment?: { payment_intent?: string } }[],
  calls: unknown[][],
): InvoicePaymentLister {
  return {
    invoicePayments: {
      list: async (params, options) => {
        calls.push([params, options]);
        return { data };
      },
    },
  };
}

test("the lookup lists the invoice's payments on the church's connected account", async () => {
  const calls: unknown[][] = [];
  const id = await fetchInvoicePaymentIntentId(
    lister(
      [{ is_default: true, status: "paid", payment: { payment_intent: "pi_listed" } }],
      calls,
    ),
    "in_dahlia",
    "acct_church",
  );

  assert.equal(id, "pi_listed");
  assert.deepEqual(calls, [
    [{ invoice: "in_dahlia", limit: 10 }, { stripeAccount: "acct_church" }],
  ]);
});

test("the lookup answers null for an invoice with no payment intent", async () => {
  assert.equal(
    await fetchInvoicePaymentIntentId(lister([], []), "in_zero", "acct_church"),
    null,
  );
});

test("a failed lookup is not an answer: the error reaches the caller", async () => {
  const failing: InvoicePaymentLister = {
    invoicePayments: {
      list: async () => {
        throw new Error("stripe_unavailable");
      },
    },
  };
  await assert.rejects(
    fetchInvoicePaymentIntentId(failing, "in_dahlia", "acct_church"),
    /stripe_unavailable/,
  );
});
