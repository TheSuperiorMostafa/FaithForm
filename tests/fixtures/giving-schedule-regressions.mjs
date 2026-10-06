// Isolated giving boundary harness: every Stripe/database access is a local mock.
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { require as loadTypeScript } from "tsx/cjs/api";
const scenario = process.argv[2];
const writes = [];
const completions = [];
const firstChargeAt = new Date(Date.now() + 60 * 86400000).toISOString();
const subscription = {
  id: "sub_mock", customer: "cus_fresh", status: "trialing", currency: "usd",
  metadata: { church_id: "church_mock", scheduled_start_at: firstChargeAt },
  latest_invoice: { amount_paid: 0 }, pending_setup_intent: { id: "seti_mock", client_secret: "seti_mock_secret", status: "requires_payment_method" },
  items: { data: [{ id: "si_mock", price: { unit_amount: 1000, recurring: { interval: "week", interval_count: 2 } } }] },
};
const stripe = {
  prices: { create: async (params, options) => { writes.push(["price", params, options]); return { id: "price_mock" }; } },
  customers: { create: async (params, options) => { writes.push(["customer", params, options]); return { id: "cus_fresh" }; } },
  subscriptions: {
    create: async (params, options) => { writes.push(["subscription", params, options]); return subscription; },
    retrieve: async () => subscription,
    update: async (id, params, options) => { writes.push(["update", params, options]); return subscription; },
    cancel: async () => subscription,
  },
  setupIntents: {
    update: async (id, params, options) => { writes.push(["setup", params, options]); return {}; },
    retrieve: async () => subscription.pending_setup_intent,
    cancel: async (id, params, options) => { writes.push(["cancel_setup", id, options]); return {}; },
  },
};
const db = {
  from(table) {
    const q = {
      select() { return q; }, eq() { return q; }, update(value) { writes.push(["db", table, value]); return q; },
      insert(value) { writes.push(["db", table, value]); return q; },
      maybeSingle: async () => ({ data: table === "churches" ? { id: "church_mock" } : null, error: null }),
      then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
    };
    return q;
  },
  rpc: async (name) => {
    if (name === "claim_giving_recurring_attempt_v2") return { data: [{ ok: true, attempt_id: "attempt_mock", amount_cents: 1000, currency: "usd", interval: "biweekly", first_charge_at: firstChargeAt, billing_day_of_week: 0, billing_day_of_month: null, fund_id: "fund_original", stripe_idempotency_key: "stable_key", stripe_subscription_id: null }] };
    assert.equal(name, "attach_giving_subscription"); return { data: [{ ok: true }] };
  },
};
const mocked = new Map([
  ["lib/stripe/client", { getStripe: () => stripe, isStripeConfigured: () => true }],
  ["lib/supabase/admin", { createAdminClient: () => db }],
  ["lib/features/access", { isChurchFeatureEmailEnabled: async () => false }],
  ["lib/stripe/receipt-delivery", { deliverDonationReceipt: async () => assert.fail("Unexpected receipt") }],
  ["lib/stripe/webhook-state", {
    claimStripeEvent: async () => ({ claimed: true, claimToken: "claim_mock", attempt: 1, status: "processing" }),
    completeStripeEvent: async (input) => completions.push(input.status),
    safeStripeFailure: () => ({ category: "test", code: "Error" }), stripeRetryAt: () => firstChargeAt,
  }],
  ["lib/faithform/account", { getVisitorAccount: async () => ({ id: "account_mock", displayName: "Donor" }) }],
  ["lib/mobile/v1/discovery-service", { resolvePublishedContentRelationshipState: async () => "member" }],
  ["lib/giving/v1/account-donor", { donorForAccount: async () => ({ ok: true, donor: { donorId: "donor_mock", customerId: "cus_old", email: "mock@example.test", name: "Donor" } }) }],
  ["lib/giving/v1/giving-service", {
    ABSOLUTE_MIN_CENTS: 100, ABSOLUTE_MAX_CENTS: 2000000, givingClient: () => db,
    resolveGivingChurch: async () => ({ ok: true, church: { churchId: "church_mock", name: "Church", stripeAccountId: "acct_mock", currency: "usd", timeZone: "America/New_York" } }),
    readFundTitle: async (church, fund) => { assert.equal(fund, "fund_original"); return "Original fund"; },
  }],
]);
const originalLoad = Module._load;
Module._load = function(request) { return mocked.get(request.replace(/^@\//, "")) ?? originalLoad.apply(this, arguments); };
const load = (file) => loadTypeScript(path.join(process.cwd(), file), import.meta.url);
if (scenario === "provider-schedule") {
  const { stripeGivingProvider } = load("lib/giving/v1/payment-provider.ts");
  const result = await stripeGivingProvider.createSubscription({ stripeAccountId: "acct_mock", customerId: "cus_fresh", amountCents: 1000, currency: "usd", interval: "biweekly", firstChargeAt, productName: "Gift", idempotencyKey: "stable", metadata: { church_id: "church_mock" } });
  assert.equal(result.confirmationType, "setup");
  assert.equal(result.clientSecret, "seti_mock_secret");
  assert.deepEqual(writes.find(([type]) => type === "price")[1].recurring, { interval: "week", interval_count: 2 });
  const [, params, options] = writes.find(([type]) => type === "subscription");
  assert.equal(params.proration_behavior, "none"); assert.ok(params.trial_end > Date.now() / 1000);
  assert.equal(params.trial_settings.end_behavior.missing_payment_method, "cancel");
  assert.equal(options.idempotencyKey, "stable"); assert.equal(options.stripeAccount, "acct_mock");
} else if (scenario === "web-schedule") {
  const { createConnectedSubscription } = load("lib/stripe/giving.ts");
  const day = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const result = await createConnectedSubscription({ stripeAccountId: "acct_mock", churchId: "church_mock", donorId: "donor_mock", donorEmail: "mock@example.test", donorName: "Mock", stripeCustomerId: "cus_old", amountCents: 1000, intendedAmountCents: 1000, coverFees: false, interval: "biweekly", startDate: day, timeZone: "UTC", fundId: "fund_mock", fundSlug: "fund", fundName: "Fund", idempotencyKey: "stable_web" });
  assert.equal(result.confirmationType, "setup");
  assert.equal(writes.find(([type]) => type === "customer")[2].idempotencyKey, "stable_web_cus");
  assert.equal(writes.find(([type]) => type === "subscription")[1].proration_behavior, "none");
  assert.equal(writes.find(([type]) => type === "subscription")[1].customer, "cus_fresh");
} else if (scenario === "retry-schedule") {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_mock";
  const { startRecurringGift } = load("lib/giving/v1/giving-recurring-service.ts");
  let seen;
  const provider = {
    ensureCustomer: async (request) => { assert.equal(request.existingCustomerId, null); return "cus_fresh"; },
    createSubscription: async (request) => { seen = request; return { id: "sub_mock", clientSecret: "seti_mock_secret", confirmationType: "setup", status: "trialing" }; },
  };
  for (let n = 0; n < 2; n++) {
    const result = await startRecurringGift({ userId: "user_mock", churchSlug: "church", fundId: "fund_changed", amountCents: 9999, interval: "month", startDate: "2020-01-01", clientAttemptId: "same_attempt", provider, supabase: db });
    assert.equal(result.ok, true); assert.equal(result.firstChargeAt, firstChargeAt);
    assert.equal(seen.idempotencyKey, "stable_key"); assert.equal(seen.interval, "biweekly");
    assert.equal(seen.amountCents, 1000); assert.equal(seen.metadata.fund_id, "fund_original");
    assert.equal(seen.firstChargeAt, firstChargeAt);
  }
} else if (scenario === "biweekly-reprice") {
  await load("lib/stripe/giving.ts").updateSubscriptionAmount("acct_mock", "sub_mock", 2000, "Fund");
  assert.deepEqual(writes.find(([type]) => type === "price")[1].recurring, { interval: "week", interval_count: 2 });
} else {
  const { processStripeEvent } = load("lib/stripe/webhooks.ts");
  const event = async (type, object, id = "evt_mock") => processStripeEvent({ id, type, created: 123, account: "acct_mock", data: { object } });
  if (scenario === "zero-invoice") {
    await event("invoice.paid", { id: "in_mock", amount_paid: 0, amount_due: 0, metadata: {} });
    await event("invoice.payment_failed", { id: "in_mock", amount_paid: 0, amount_due: 0, metadata: {} }, "evt_failed");
    assert.equal(writes.length, 0);
  } else if (scenario === "pending-cancel") {
    await event("customer.subscription.deleted", { ...subscription, status: "canceled" });
    assert.equal(writes.filter(([type]) => type === "cancel_setup").length, 1);
  } else {
    if (scenario === "setup-church-mismatch") subscription.metadata.church_id = "church_foreign";
    if (scenario === "setup-newer-card") subscription.default_payment_method = "pm_newer";
    const setup = { id: "seti_mock", status: "succeeded", customer: scenario === "setup-mismatch" ? "cus_foreign" : "cus_fresh", payment_method: "pm_mock", metadata: { church_id: "church_mock", faithform_subscription_id: "sub_mock" } };
    await event("setup_intent.succeeded", setup);
    if (["setup-mismatch", "setup-church-mismatch", "setup-newer-card"].includes(scenario)) assert.equal(writes.length, 0);
    else {
      await event("setup_intent.succeeded", setup);
      const updates = writes.filter(([type]) => type === "update");
      assert.equal(updates.length, 2);
      assert.equal(updates[0][1].default_payment_method, "pm_mock");
      assert.deepEqual(updates[0][2], updates[1][2]);
      assert.equal(writes.some(([type]) => type === "db"), false);
    }
  }
}
console.log(`Passed ${scenario}`);
