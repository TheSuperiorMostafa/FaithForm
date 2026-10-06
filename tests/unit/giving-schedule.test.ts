import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { recurringFirstChargeAt, recurringSubscriptionSchedule, stripeRecurringPrice } from "@/lib/giving/recurring-schedule";
import { toYMD } from "@/lib/utils/dates";

const now = new Date("2026-01-01T03:00:00Z");
test("biweekly is two weeks rather than two charges per month", () => {
  assert.deepEqual(stripeRecurringPrice("biweekly"), { interval: "week", interval_count: 2 });
});
test("future start dates align to the chosen day, including month ends", () => {
  assert.equal(recurringFirstChargeAt({ interval: "month", startDate: "2026-02-01", billingDayOfMonth: 31 }, now), "2026-02-28T12:00:00.000Z");
  assert.equal(recurringFirstChargeAt({ interval: "month", startDate: "2028-02-01", billingDayOfMonth: 31 }, new Date("2028-01-01")), "2028-02-29T12:00:00.000Z");
  assert.equal(recurringFirstChargeAt({ interval: "biweekly", startDate: "2026-01-10", billingDayOfWeek: 0 }, now), "2026-01-11T12:00:00.000Z");
  assert.throws(() => recurringFirstChargeAt({ interval: "month", startDate: "2026-02-30" }, now));
});
test("today is based on the church timezone, including UTC boundary extremes", () => {
  assert.equal(recurringFirstChargeAt({ interval: "month", startDate: "2025-12-31", timeZone: "America/Los_Angeles" }, now), null);
  for (const timeZone of ["Pacific/Kiritimati", "Etc/GMT+12", "America/New_York"]) {
    const first = recurringFirstChargeAt({ interval: "month", startDate: "2026-03-31", billingDayOfMonth: 31, timeZone }, now)!;
    assert.equal(toYMD(new Date(first), timeZone), "2026-03-31");
    assert.equal(first.slice(0, 10), "2026-03-31");
  }
});
test("scheduling cannot produce a current prorated charge", () => {
  const params = recurringSubscriptionSchedule({ interval: "month", firstChargeAt: "2026-02-28T12:00:00Z", billingDayOfMonth: 31 }, now);
  assert.equal(params.trial_end, 1772280000);
  assert.equal(params.proration_behavior, "none");
  assert.equal(params.trial_settings?.end_behavior.missing_payment_method, "cancel");
  assert.equal(params.billing_cycle_anchor_config?.day_of_month, 31);
  assert.throws(() => recurringSubscriptionSchedule({ interval: "week", firstChargeAt: "2025-12-01" }, now));
});
for (const scenario of ["provider-schedule", "web-schedule", "retry-schedule", "biweekly-reprice", "setup-webhook", "setup-mismatch", "setup-church-mismatch", "setup-newer-card", "pending-cancel", "zero-invoice"]) {
  test(`mock giving boundary: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["tests/fixtures/giving-schedule-regressions.mjs", scenario], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
