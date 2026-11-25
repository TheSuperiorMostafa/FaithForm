// Fund-account routing harness: an in-memory database, no network.
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { require as loadTypeScript } from "tsx/cjs/api";

const scenario = process.argv[2];

function makeDb(tables, faults = {}) {
  return {
    tables,
    from(table) {
      const filters = [];
      let op = "read";
      let payload = null;
      const rows = () => (tables[table] ??= []);
      const matching = () => rows().filter((row) => filters.every((f) => f(row)));
      const q = {
        select() { return q; },
        eq(key, value) { filters.push((row) => row[key] === value); return q; },
        is(key, value) { filters.push((row) => (row[key] ?? null) === value); return q; },
        not(key, _op, value) { filters.push((row) => (row[key] ?? null) !== value); return q; },
        order() { return q; },
        limit() { return q; },
        range() { return q; },
        gte() { return q; },
        update(value) { op = "update"; payload = value; return q; },
        insert(value) { op = "insert"; payload = value; return q; },
        maybeSingle() { return Promise.resolve(run(true)); },
        single() { return Promise.resolve(run(true)); },
        then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
      };
      function run(single) {
        if (faults[table]) return { data: null, error: faults[table] };
        if (op === "update") {
          const hit = matching();
          for (const row of hit) Object.assign(row, payload);
          return { data: single ? hit[0] ?? null : hit, error: null };
        }
        if (op === "insert") {
          const row = { id: `${table}_${rows().length + 1}`, ...payload };
          rows().push(row);
          return { data: row, error: null };
        }
        // Copies, as a real client returns: a later update must not change a read.
        const hit = matching().map((row) => structuredClone(row));
        return { data: single ? hit[0] ?? null : hit, error: null };
      }
      return q;
    },
  };
}

let db = makeDb({});
const mocked = new Map([
  ["lib/supabase/admin", { createAdminClient: () => db }],
  ["lib/stripe/client", { getStripe: () => assert.fail("no Stripe call expected"), isStripeConfigured: () => true }],
  ["lib/stripe/config", { getSiteUrl: () => "https://example.test", getGivePageUrl: () => "https://example.test/give/x" }],
]);
const originalLoad = Module._load;
Module._load = function (request) {
  return mocked.get(request.replace(/^@\//, "")) ?? originalLoad.apply(this, arguments);
};
const load = (file) => loadTypeScript(path.join(process.cwd(), file), import.meta.url);

const church = () => ({ id: "c1", stripe_account_id: "acct_main", stripe_charges_enabled: true, stripe_requirements_due: [] });
const account = (overrides = {}) => ({
  id: "acct_fund",
  object: "account",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [] },
  metadata: { church_id: "c1", faithform_fund_account: "true" },
  settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } },
  ...overrides,
});
const fundRow = (overrides = {}) => ({
  id: "r1", church_id: "c1", stripe_account_id: "acct_fund", label: "Missions account", is_primary: false,
  status: "pending", charges_enabled: false, payouts_enabled: false, details_submitted: false,
  requirements_due: [], created_at: "2026-01-01T00:00:00Z", ...overrides,
});

if (scenario === "sync-fund-account") {
  db = makeDb({
    churches: [church()],
    giving_stripe_accounts: [fundRow()],
    giving_funds: [
      { id: "f_missions", church_id: "c1", giving_stripe_account_id: null, pending_giving_stripe_account_id: "r1" },
      { id: "f_general", church_id: "c1", giving_stripe_account_id: null, pending_giving_stripe_account_id: null },
    ],
  });
  const { syncChurchFromStripeAccount } = load("lib/stripe/connect.ts");
  const result = await syncChurchFromStripeAccount(account());
  assert.equal(result.isPrimary, false);
  assert.equal(db.tables.churches[0].stripe_account_id, "acct_main", "a fund account must never replace the main account");
  const row = db.tables.giving_stripe_accounts[0];
  assert.equal(row.status, "active");
  assert.equal(row.charges_enabled, true);
  assert.deepEqual(row.payout_schedule, { interval: "daily", delay_days: 2, weekly_anchor: null, monthly_anchor: null });
  const [missions, general] = db.tables.giving_funds;
  assert.equal(missions.giving_stripe_account_id, "r1", "a waiting fund switches once its account is active");
  assert.equal(missions.pending_giving_stripe_account_id, null);
  assert.equal(general.giving_stripe_account_id, null);
} else if (scenario === "sync-pending-keeps-fund") {
  db = makeDb({
    churches: [church()],
    giving_stripe_accounts: [fundRow()],
    giving_funds: [{ id: "f_missions", church_id: "c1", giving_stripe_account_id: null, pending_giving_stripe_account_id: "r1" }],
  });
  const { syncChurchFromStripeAccount } = load("lib/stripe/connect.ts");
  await syncChurchFromStripeAccount(account({ payouts_enabled: false }));
  assert.equal(db.tables.giving_funds[0].giving_stripe_account_id, null, "no switch before payouts are enabled");
  assert.equal(db.tables.giving_funds[0].pending_giving_stripe_account_id, "r1");
} else if (scenario === "sync-requirements-alert") {
  db = makeDb({ churches: [church()], giving_stripe_accounts: [fundRow({ status: "active" })], giving_funds: [] });
  const { syncChurchFromStripeAccount } = load("lib/stripe/connect.ts");
  const result = await syncChurchFromStripeAccount(account({ requirements: { currently_due: ["external_account"] } }));
  assert.equal(result.requirementsBecameDue, true);
  assert.deepEqual(db.tables.giving_stripe_accounts[0].requirements_due, ["external_account"]);
  const again = await syncChurchFromStripeAccount(account({ requirements: { currently_due: ["external_account"] } }));
  assert.equal(again.requirementsBecameDue, false, "an admin is told once, not on every update");
} else if (scenario === "sync-foreign-account-ignored") {
  db = makeDb({ churches: [church()], giving_stripe_accounts: [], giving_funds: [] });
  const { syncChurchFromStripeAccount } = load("lib/stripe/connect.ts");
  const result = await syncChurchFromStripeAccount(account({ id: "acct_other", metadata: { church_id: "c1" } }));
  assert.equal(result, null);
  assert.equal(db.tables.churches[0].stripe_account_id, "acct_main");
} else if (scenario === "sync-fund-account-row-missing") {
  db = makeDb({ churches: [church()], giving_stripe_accounts: [], giving_funds: [] });
  const { syncChurchFromStripeAccount } = load("lib/stripe/connect.ts");
  await assert.rejects(syncChurchFromStripeAccount(account({ id: "acct_new" })), /stripe_fund_account_not_ready/);
  assert.equal(db.tables.churches[0].stripe_account_id, "acct_main");
} else if (scenario === "sync-primary-mirrors-row") {
  db = makeDb({ churches: [church()], giving_stripe_accounts: [], giving_funds: [] });
  const { syncChurchFromStripeAccount } = load("lib/stripe/connect.ts");
  const result = await syncChurchFromStripeAccount(account({ id: "acct_main", metadata: { church_id: "c1" } }));
  assert.equal(result.isPrimary, true);
  const mirrored = db.tables.giving_stripe_accounts[0];
  assert.equal(mirrored.stripe_account_id, "acct_main");
  assert.equal(mirrored.is_primary, true);
} else if (scenario === "resolve") {
  const { resolveFundStripeAccount } = load("lib/giving/stripe-accounts.ts");
  db = makeDb({
    churches: [church()],
    giving_funds: [
      { id: "f_general", church_id: "c1", giving_stripe_account_id: null },
      { id: "f_missions", church_id: "c1", giving_stripe_account_id: "r1" },
      { id: "f_building", church_id: "c1", giving_stripe_account_id: "r2" },
    ],
    giving_stripe_accounts: [
      fundRow({ status: "active", charges_enabled: true, payouts_enabled: true }),
      fundRow({ id: "r2", stripe_account_id: "acct_building" }),
    ],
  });
  assert.deepEqual(await resolveFundStripeAccount("c1", "f_general", db), { ok: true, stripeAccountId: "acct_main", isPrimary: true, accountRowId: null });
  assert.deepEqual(await resolveFundStripeAccount("c1", "f_missions", db), { ok: true, stripeAccountId: "acct_fund", isPrimary: false, accountRowId: "r1" });
  assert.deepEqual(await resolveFundStripeAccount("c1", "f_building", db), { ok: false, reason: "fund_account_not_ready" }, "never falls back to the main bank");
  assert.deepEqual(await resolveFundStripeAccount("c2", "f_missions", db), { ok: false, reason: "church_not_connected" });
  db.tables.churches.push({ id: "c2", stripe_account_id: "acct_c2", stripe_charges_enabled: true });
  assert.deepEqual(await resolveFundStripeAccount("c2", "f_missions", db), { ok: false, reason: "fund_not_found" }, "another church's fund is not found");
  const preMigration = makeDb({ churches: [church()] }, { giving_funds: { code: "42703", message: "column giving_funds.giving_stripe_account_id does not exist" } });
  assert.deepEqual(await resolveFundStripeAccount("c1", "f_general", preMigration), { ok: true, stripeAccountId: "acct_main", isPrimary: true, accountRowId: null });
} else if (scenario === "pin") {
  const { pinAttemptStripeAccount } = load("lib/giving/stripe-accounts.ts");
  db = makeDb({
    giving_donation_attempts: [
      { id: "a1", church_id: "c1", stripe_account_id: "acct_fund" },
      { id: "a2", church_id: "c1", stripe_account_id: null },
    ],
    giving_funds: [{ id: "f_general", church_id: "c1", giving_stripe_account_id: null }],
  });
  const base = { db, table: "giving_donation_attempts", churchId: "c1", fundId: "f_general", primaryAccountId: "acct_main" };
  assert.deepEqual(await pinAttemptStripeAccount({ ...base, attemptId: "a1" }), { ok: true, stripeAccountId: "acct_fund" }, "a resume keeps its account");
  assert.deepEqual(await pinAttemptStripeAccount({ ...base, attemptId: "a2" }), { ok: true, stripeAccountId: "acct_main" });
  assert.equal(db.tables.giving_donation_attempts[1].stripe_account_id, "acct_main");
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
