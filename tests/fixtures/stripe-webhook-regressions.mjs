// Isolated handler harness. No provider or database client may be constructed.
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { require as loadTypeScript } from "tsx/cjs/api";
const scenario = process.argv[2];
const root = process.cwd();
const completed = [];
const projections = [];
let donation = null;
let subscriptionWrite = null;
let subscriptionReads = 0;
const subscription = {
  id: "sub_mock", customer: "", status: "active", currency: "usd", metadata: {},
  items: { data: [{ price: { unit_amount: 1000, recurring: { interval: "month" } } }] },
  pause_collection: { behavior: "void" },
};
const db = {
  from(table) {
    let operation = "read";
    let row;
    let bound;
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      or(value) { bound = value.split(".lte.")[1]; return query; },
      update(value) { operation = "update"; row = value; return query; },
      insert(value) { operation = "insert"; row = value; return query; },
      maybeSingle() { return Promise.resolve(resolve()); },
      then(onResolve, onReject) { return Promise.resolve(resolve()).then(onResolve, onReject); },
    };
    function resolve() {
      if (table === "churches") return { data: { id: "church_mock" }, error: null };
      if (table === "giving_subscriptions") {
        if (operation === "read") {
          subscriptionReads++;
          return { data: scenario === "subscription-insert-race" && subscriptionReads === 1 ? null : { id: "sub_row" }, error: null };
        }
        subscriptionWrite = row;
        if (scenario === "subscription-insert-race" && operation === "insert") return { error: { code: "23505" } };
        if (scenario.startsWith("subscription-error") || scenario === "subscription-insert-race") return { error: { code: "08006" } };
        return { data: null, error: null };
      }
      assert.equal(table, "giving_donations", `Unexpected table ${table}`);
      if (operation === "insert") {
        donation = { ...row, id: "donation_mock" };
        return { data: donation, error: null };
      }
      if (operation === "update" && (scenario === "dispute-error" || scenario === "refund-error")) return { data: null, error: { code: "08006" } };
      if (operation === "read" && scenario === "dispute-projection-read-error") return { data: null, error: { code: "08006" } };
      const matches = donation && Object.entries(filters).every(([key, value]) => donation[key] === value);
      if (!matches) return { data: null, error: null };
      if (operation === "update") {
        if (bound && donation.stripe_event_created_at > bound) return { data: null, error: null };
        donation = { ...donation, ...row };
      }
      return { data: donation, error: null };
    }
    return query;
  },
  async rpc(name, input) {
    assert.equal(name, "project_giving_attempt_state");
    projections.push(input.p_status);
    return { data: [{ ok: true }], error: scenario.endsWith("rpc-error") ? { code: "08006" } : null };
  },
};
const mocked = new Map([
  ["lib/supabase/admin", { createAdminClient: () => db }],
  ["lib/stripe/client", { getStripe: () => { throw new Error("Provider access forbidden in regression harness"); } }],
  ["lib/stripe/receipt-delivery", { deliverDonationReceipt: async () => {} }],
  ["lib/stripe/webhook-state", {
    claimStripeEvent: async () => ({ claimed: true, claimToken: "claim_mock", attempt: 1, status: "processing" }),
    completeStripeEvent: async (input) => completed.push(input.status),
    safeStripeFailure: () => ({ category: "test", code: "Error" }),
    stripeRetryAt: () => new Date().toISOString(),
  }],
]);
const originalLoad = Module._load;
Module._load = function (request) {
  return mocked.get(request.replace(/^@\//, "")) ?? originalLoad.apply(this, arguments);
};
const { processStripeEvent } = loadTypeScript(path.join(root, "lib/stripe/webhooks.ts"), import.meta.url);
async function event(type, object, created = 123) {
  return processStripeEvent({ id: `evt_mock_${completed.length}`, type, created, account: "acct_mock", data: { object } });
}
function seedDonation(created = 123) {
  donation = { id: "donation_mock", church_id: "church_mock", stripe_payment_intent_id: "pi_mock", stripe_charge_id: "ch_mock", status: "succeeded", stripe_event_created_at: new Date(created * 1000).toISOString() };
}
(async () => {
  if (scenario === "refund-order") {
    const charge = { payment_intent: "pi_mock", refunded: true, metadata: {} };
    await assert.rejects(event("charge.refunded", charge, 124), /donation_state_not_ready/);
    assert.deepEqual(completed, ["retryable"]);
    await event("payment_intent.succeeded", { id: "pi_mock", amount: 1000, currency: "usd", metadata: {}, latest_charge: null }, 123);
    assert.equal(donation.status, "succeeded");
    await event("charge.refunded", charge, 124);
    assert.equal(donation.status, "refunded");
    assert.deepEqual(completed, ["retryable", "processed", "processed"]);
  } else if (scenario.startsWith("subscription-error") || scenario === "subscription-insert-race") {
    await assert.rejects(event("customer.subscription.updated", subscription), /subscription_reconciliation_failed/);
    assert.deepEqual(completed, ["retryable"]);
  } else if (scenario === "pause-collection") {
    await event("customer.subscription.updated", subscription);
    assert.equal(subscriptionWrite.status, "active");
    assert.ok(subscriptionWrite.paused_at);
    subscription.pause_collection = null;
    await event("customer.subscription.updated", subscription, 124);
    assert.equal(subscriptionWrite.paused_at, null);
  } else if (scenario === "refund-rpc-error" || scenario === "dispute-rpc-error" || scenario === "dispute-projection-read-error") {
    seedDonation();
    const refund = scenario.startsWith("refund");
    await assert.rejects(event(refund ? "charge.refunded" : "charge.dispute.closed", refund ? { payment_intent: "pi_mock", refunded: true } : { charge: "ch_mock", status: "lost" }, 124), /giving_attempt_(?:projection|lookup)_failed/);
    assert.deepEqual(completed, ["retryable"]);
    assert.equal(donation.status, "refunded");
  } else if (scenario === "refund-error") {
    seedDonation();
    await assert.rejects(event("charge.refunded", { payment_intent: "pi_mock", refunded: true }, 124), /donation_state_reconciliation_failed/);
    assert.deepEqual(completed, ["retryable"]);
    assert.equal(donation.status, "succeeded");
  } else if (scenario === "partial-refund") {
    seedDonation();
    await event("charge.refunded", { payment_intent: "pi_mock", refunded: false, amount: 1000, amount_refunded: 100 }, 124);
    assert.equal(donation.status, "succeeded");
    assert.deepEqual(completed, ["processed"]);
    assert.deepEqual(projections, []);
  } else if (scenario === "cross-church-refund") {
    seedDonation();
    donation.church_id = "other_church_mock";
    await assert.rejects(event("charge.refunded", { payment_intent: "pi_mock", refunded: true }, 124), /donation_state_not_ready/);
    assert.equal(donation.status, "succeeded");
    assert.deepEqual(projections, []);
    assert.deepEqual(completed, ["retryable"]);
  } else if (scenario === "dispute-before-donation") {
    await assert.rejects(event("charge.dispute.created", { charge: "ch_mock" }), /donation_state_not_ready/);
    assert.deepEqual(completed, ["retryable"]);
    assert.deepEqual(projections, []);
  } else if (scenario === "dispute-error") {
    seedDonation();
    await assert.rejects(event("charge.dispute.created", { charge: "ch_mock" }), /donation_state_reconciliation_failed/);
    assert.deepEqual(completed, ["retryable"]);
  } else if (scenario.startsWith("dispute-closed")) {
    seedDonation();
    const lost = scenario.endsWith("lost");
    await event("charge.dispute.closed", { charge: "ch_mock", status: lost ? "lost" : "won" }, 124);
    assert.equal(donation.status, lost ? "refunded" : "succeeded");
    assert.deepEqual(projections, [lost ? "refunded" : "succeeded"]);
  } else if (scenario === "stale-refund") {
    seedDonation(125);
    await event("charge.refunded", { payment_intent: "pi_mock", refunded: true }, 124);
    assert.equal(donation.status, "succeeded");
    assert.deepEqual(projections, []);
    assert.deepEqual(completed, ["processed"]);
  } else if (scenario === "equal-time-refund") {
    seedDonation();
    await event("charge.refunded", { payment_intent: "pi_mock", refunded: true }, 123);
    assert.equal(donation.status, "refunded");
    assert.deepEqual(projections, ["refunded"]);
  } else throw new Error(`Unknown scenario ${scenario}`);
  console.log(`Passed ${scenario}`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
