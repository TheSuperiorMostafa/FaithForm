// Real portal handlers with isolated database, cookies and Stripe boundaries.
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { require as loadTypeScript } from "tsx/cjs/api";

const scenario = process.argv[2];
const session = { churchId: "church-a", donorId: "donor-a", sessionId: "session-a" };
const subscriptionId = "11111111-1111-4111-8111-111111111111";
const fundId = "22222222-2222-4222-8222-222222222222";
let flag = "enabled";
let flagReads = 0;
let revocationFails = false;
let revoked = false;
let revocations = 0;
const effects = [];
const deletes = [];
const cookies = new Map();
const cookieStore = {
  get: (name) => cookies.has(name) ? { value: cookies.get(name) } : undefined,
  delete: ({ name }) => { deletes.push(name); cookies.delete(name); },
};

const db = {
  from(table) {
    const filters = {};
    let update;
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      is(key, value) { filters[key] = value; return query; },
      update(value) { update = value; return query; },
      maybeSingle: async () => resolve(),
      single: async () => resolve(),
      then(resolvePromise, rejectPromise) { return Promise.resolve(resolve()).then(resolvePromise, rejectPromise); },
    };
    function resolve() {
      if (table === "church_features") {
        flagReads++;
        assert.equal(filters.church_id, session.churchId);
        assert.equal(filters.feature_key, "giving");
        return flag === "error" ? { data: null, error: { message: "test flag lookup fault" } }
          : { data: flag === "absent" ? null : { enabled: flag === "enabled" }, error: null };
      }
      if (table === "donor_portal_sessions") {
        assert.equal(filters.id, session.sessionId);
        assert.equal(filters.church_id, session.churchId);
        assert.equal(filters.donor_id, session.donorId);
        if (update) {
          revocations++;
          assert.ok(update.revoked_at);
          if (revocationFails) return { data: null, error: { message: "sensitive database diagnostic" } };
          revoked = true;
          return { data: null, error: null };
        }
        return { data: { id: session.sessionId, church_id: session.churchId, donor_id: session.donorId,
          session_expires_at: new Date(Date.now() + 86400000).toISOString(), used_at: new Date().toISOString(),
          revoked_at: revoked ? new Date().toISOString() : null }, error: null };
      }
      if (table === "giving_donors") {
        assert.equal(filters.id, session.donorId);
        assert.equal(filters.church_id, session.churchId);
        return { data: { id: session.donorId, email: "donor@example.invalid", stripe_customer_id: "cus_a" }, error: null };
      }
      if (table === "giving_subscriptions") {
        assert.equal(filters.id, subscriptionId);
        assert.equal(filters.church_id, session.churchId);
        assert.equal(filters.donor_id, session.donorId);
        return { data: { stripe_subscription_id: "sub_a", donor_id: session.donorId, amount_cents: 1000,
          giving_funds: { name: "General" } }, error: null };
      }
      assert.equal(table, "churches", `Unexpected table ${table}`);
      assert.equal(filters.id, session.churchId);
      return { data: { id: session.churchId, stripe_account_id: "acct_a" }, error: null };
    }
    return query;
  },
};
const record = (name) => async (...args) => {
  effects.push(name);
  if (["pause", "resume", "cancel", "update"].includes(name)) {
    assert.equal(args[0], "acct_a");
    assert.equal(args[1], "sub_a");
  } else {
    assert.equal(args[0].stripeAccountId, "acct_a");
    assert.equal(args[0].churchId, session.churchId);
    assert.equal(args[0].donorId, session.donorId);
  }
  return name === "create-subscription" ? { subscription: { id: "sub_new" }, clientSecret: "secret_mock", customerId: "cus_a" }
    : { id: "pi_new", client_secret: "secret_mock" };
};
const mocks = new Map([
  ["next/headers", { cookies: async () => cookieStore }],
  ["lib/supabase/admin", { createAdminClient: () => db, createAdminClientOrNull: () => db }],
  ["lib/stripe/client", { isStripeConfigured: () => true }],
  ["lib/stripe/giving", {
    createConnectedPaymentIntent: record("create-intent"), createConnectedSubscription: record("create-subscription"),
    pauseSubscription: record("pause"), resumeSubscription: record("resume"),
    cancelSubscription: record("cancel"), updateSubscriptionAmount: record("update"),
  }],
  ["lib/giving/donors", {
    upsertGivingDonor: async () => ({ donorId: session.donorId, stripeCustomerId: "cus_a" }),
    linkDonorStripeCustomer: async () => {},
  }],
  ["lib/giving/funds", { getFundById: async () => ({ id: fundId, slug: "general", name: "General" }) }],
  ["lib/queries/giving", { getChurchBySlug: async () => ({ churchId: session.churchId, slug: "church-a",
    stripeAccountId: "acct_a", stripeChargesEnabled: true }) }],
]);
if (scenario === "giving-gates") {
  mocks.set("lib/giving/portal-session", { getDonorPortalSession: async () => session });
}
const originalLoad = Module._load;
Module._load = function (request) {
  return mocks.get(request.replace(/^@\//, "")) ?? originalLoad.apply(this, arguments);
};
const load = (file) => loadTypeScript(path.join(process.cwd(), file), import.meta.url);
const request = (body) => new Request("https://faithform.invalid/api/give/portal", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

try {
  if (scenario === "giving-gates") {
    const intent = load("app/api/give/portal/create-intent/route.ts").POST;
    const recurring = load("app/api/give/portal/create-subscription/route.ts").POST;
    const manage = load("app/api/give/portal/subscription/route.ts").POST;
    const gift = { slug: "church-a", amountCents: 1000, donorName: "Donor", fundId,
      interval: "month", billingDayOfMonth: 1 };
    const moneyMoving = [
      () => intent(request(gift)), () => recurring(request(gift)),
      () => manage(request({ slug: "church-a", action: "resume", subscriptionId })),
      () => manage(request({ slug: "church-a", action: "update_amount", subscriptionId, newAmountCents: 1500 })),
    ];
    for (const state of ["disabled", "error"]) {
      flag = state;
      for (const call of moneyMoving) {
        const before = effects.length;
        assert.equal((await call()).status, 404);
        assert.equal(effects.length, before, "a failed permission check must never call Stripe");
      }
      for (const action of ["pause", "cancel"]) {
        const beforeReads = flagReads;
        assert.equal((await manage(request({ slug: "church-a", action, subscriptionId }))).status, 200);
        assert.equal(flagReads, beforeReads, "stopping a charge must not depend on a feature read");
        assert.equal(effects.at(-1), action);
      }
    }
    for (const state of ["enabled", "absent"]) {
      flag = state;
      for (const call of moneyMoving) assert.equal((await call()).status, 200);
    }
  } else {
    assert.equal(scenario, "sign-out-retry");
    process.env.DONOR_PORTAL_SESSION_SECRET = "portal-session-regression-secret-at-least-32-bytes";
    const realSession = load("lib/giving/portal-session.ts");
    const signed = realSession.buildSignedPortalSession({ version: 2, ...session, exp: Date.now() + 86400000 });
    cookies.set("ff_donor_portal_v2", signed);
    const signOut = load("app/api/give/portal/sign-out/route.ts").POST;
    assert.deepEqual(await realSession.getDonorPortalSession("church-a"), session);
    revocationFails = true;
    const failed = await signOut(request({ slug: "church-a" }));
    assert.equal(failed.status, 503);
    assert.doesNotMatch(JSON.stringify(await failed.json()), /sensitive database diagnostic/);
    assert.equal(revoked, false);
    assert.deepEqual(deletes, []);
    assert.equal(cookies.get("ff_donor_portal_v2"), signed);
    revocationFails = false;
    const success = await signOut(request({ slug: "church-a" }));
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { ok: true });
    assert.equal(revocations, 2);
    assert.equal(revoked, true);
    assert.equal(cookies.has("ff_donor_portal_v2"), false);
    assert.deepEqual(deletes, ["ff_donor_portal_v2", "ff_donor_session"]);
    cookies.set("ff_donor_portal_v2", signed);
    assert.equal(await realSession.getDonorPortalSession("church-a"), null, "copied cookie cannot replay after successful revocation");
    cookies.clear();
    assert.equal((await signOut(request({ slug: "church-a" }))).status, 200, "already signed-out requests remain idempotent");
  }
  console.log(`Passed ${scenario}`);
} finally {
  Module._load = originalLoad;
}
