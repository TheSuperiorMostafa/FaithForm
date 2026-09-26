import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { receiptAmountCents } from "@/lib/stripe/webhooks";

/**
 * A church's receipt is a tax acknowledgment. It printed
 * `intended_amount_cents`, which the give form sends, so a donor could pay $1
 * and be emailed a receipt for any amount. And the webhook's bookkeeping let a
 * partial refund, a closed inquiry, or a renewal's two same-second events take
 * a real gift off a donor's statement.
 */

test("a receipt never states more than was charged", () => {
  assert.equal(receiptAmountCents({ intended_amount_cents: "1000000000" }, 100), 100);
  assert.equal(receiptAmountCents({ intended_amount_cents: "50000" }, 5000), 5000, "a lowered recurring gift");
});

test("covering the fees still receipts the gift, not the fees", () => {
  assert.equal(receiptAmountCents({ intended_amount_cents: "10000" }, 10330), 10000);
});

test("missing or nonsense metadata falls back to the charge", () => {
  assert.equal(receiptAmountCents({}, 2500), 2500);
  assert.equal(receiptAmountCents(null, 2500), 2500);
  assert.equal(receiptAmountCents({ intended_amount_cents: "abc" }, 2500), 2500);
  assert.equal(receiptAmountCents({ intended_amount_cents: "-5" }, 2500), 2500);
});

const giving = readFileSync("lib/stripe/giving.ts", "utf8");
const webhooks = readFileSync("lib/stripe/webhooks.ts", "utf8");

test("without fee coverage the metadata's intended amount is the charge", () => {
  assert.equal(
    (giving.match(/const intendedAmountCents = input\.coverFees \? input\.intendedAmountCents : input\.amountCents;/g) ?? [])
      .length,
    2,
    "one-time and recurring",
  );
  const update = giving.slice(giving.indexOf("export async function updateSubscriptionAmount"));
  assert.match(update.slice(0, update.indexOf("\n}\n")), /intended_amount_cents: String\(newAmountCents\)/);
});

test("both receipt paths are bounded by the charge", () => {
  assert.match(webhooks, /intendedAmountCents: receiptAmountCents\(pi\.metadata, pi\.amount\)/);
  assert.match(webhooks, /intendedAmountCents = receiptAmountCents\(\s*sub\.metadata,/);
  assert.doesNotMatch(webhooks, /parseIntendedCents\(pi\.metadata\) \?\? pi\.amount/);
});

test("a partial refund leaves the gift counted; only a full one refunds it", () => {
  const refund = webhooks.slice(webhooks.indexOf('case "charge.refunded"'), webhooks.indexOf('case "invoice.paid"'));
  assert.match(refund, /charge\.refunded !== true/);
  assert.ok(refund.indexOf("charge.refunded !== true") < refund.indexOf('status: "refunded"'));
  assert.match(refund, /if \(refundError\) throw/);
});

test("only a lost dispute takes a gift off the statement", () => {
  assert.match(webhooks, /dispute\.status === "lost" \? "refunded" : "succeeded"/);
});

test("an update never clears what an earlier event of the same gift filled in", () => {
  const upsert = webhooks.slice(webhooks.indexOf("async function upsertDonation"));
  const body = upsert.slice(0, upsert.indexOf("\nasync function "));
  assert.doesNotMatch(body, /\.update\(row\)/, "updates must use the null-stripped row");
  assert.equal((body.match(/\.update\(updateRow\)/g) ?? []).length, 3);
  for (const column of ["donor_id", "fund_id", "stripe_invoice_id", "stripe_subscription_id"]) {
    assert.match(webhooks, new RegExp(`NEVER_CLEARED_ON_UPDATE = \\[[^\\]]*"${column}"`));
  }
  assert.match(body, /delete updateRow\.gift_type/);
});
