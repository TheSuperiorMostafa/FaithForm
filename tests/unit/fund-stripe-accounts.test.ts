import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { accountCanTakeGifts, isMissingFundAccountSchema } from "@/lib/giving/stripe-accounts";
import { fundAccountStatus } from "@/lib/queries/fund-accounts";

test("a fund account takes gifts only when it can charge and pay out", () => {
  assert.equal(accountCanTakeGifts({ chargesEnabled: true, payoutsEnabled: true, status: "active" }), true);
  assert.equal(accountCanTakeGifts({ chargesEnabled: true, payoutsEnabled: false, status: "active" }), false);
  assert.equal(accountCanTakeGifts({ chargesEnabled: true, payoutsEnabled: true, status: "deauthorized" }), false);
});

test("Funds & Banks status reads plainly from Stripe's flags", () => {
  const base = { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] as string[] };
  assert.equal(fundAccountStatus({ ...base, status: "active" }), "active");
  assert.equal(fundAccountStatus({ ...base, status: "active", requirementsDue: ["external_account"] }), "needs_info");
  assert.equal(fundAccountStatus({ ...base, status: "pending", chargesEnabled: false }), "pending");
  assert.equal(fundAccountStatus({ ...base, status: "deauthorized" }), "disconnected");
});

test("only errors about the new schema read as a database without migration 0182", () => {
  assert.equal(isMissingFundAccountSchema({ code: "42P01", message: "relation does not exist" }), true);
  assert.equal(isMissingFundAccountSchema({ message: "column giving_funds.giving_stripe_account_id does not exist" }), true);
  assert.equal(isMissingFundAccountSchema({ code: "08006", message: "connection failure" }), false);
  assert.equal(isMissingFundAccountSchema(null), false);
});

for (const scenario of [
  "sync-fund-account",
  "sync-pending-keeps-fund",
  "sync-requirements-alert",
  "sync-foreign-account-ignored",
  "sync-fund-account-row-missing",
  "sync-primary-mirrors-row",
  "resolve",
  "pin",
]) {
  test(`fund account routing: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["tests/fixtures/fund-stripe-accounts.mjs", scenario], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
