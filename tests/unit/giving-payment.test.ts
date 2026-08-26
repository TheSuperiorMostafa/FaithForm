import assert from "node:assert/strict";
import test from "node:test";

import { attemptStatusForIntent } from "@/lib/giving/v1/payment-provider";
import {
  MAX_SUGGESTED_AMOUNTS,
  PLATFORM_MAX_CENTS,
  PLATFORM_MIN_CENTS,
  normaliseAmounts,
} from "@/lib/giving/v1/publication";

/**
 * The Stripe boundary, against fixtures.
 *
 * Nothing here reaches Stripe, and nothing here claims anything about live
 * Stripe behaviour — that is a test-mode item in the runbook. What is tested is
 * the part this repository owns: how a provider status becomes an app state, and
 * what a church is allowed to configure.
 */

// ---------------------------------------------------------------------------
// Provider status → attempt state
// ---------------------------------------------------------------------------

test("every Stripe payment-intent status maps to an app state", () => {
  // The statuses Stripe documents for a payment intent. Each has to become
  // something this app can show a person, and two of them are the ones that
  // matter: `processing` is not success, and `succeeded` here still is not a
  // receipt — the webhook writes that.
  const cases: [string, string][] = [
    ["requires_payment_method", "initiated"],
    ["requires_confirmation", "initiated"],
    ["requires_action", "requires_action"],
    ["processing", "processing"],
    ["succeeded", "succeeded"],
    ["canceled", "cancelled"],
  ];
  for (const [stripe, app] of cases) {
    assert.equal(attemptStatusForIntent(stripe), app, stripe);
  }
});

test("an unrecognised provider status is not a guess", () => {
  // A status a newer Stripe API introduces must keep a client asking rather than
  // resolve into anything. Guessing here would be wrong exactly when the
  // provider had something new to say.
  for (const unknown of ["requires_capture", "settling", "", "SUCCEEDED"]) {
    assert.equal(attemptStatusForIntent(unknown), "initiated", unknown);
  }
});

test("Stripe's spelling of cancelled is normalised, once", () => {
  // Stripe writes `canceled`; this app writes `cancelled`. One translation, in
  // one place — two would eventually disagree, and the disagreement would be a
  // phone showing a gift as pending forever.
  assert.equal(attemptStatusForIntent("canceled"), "cancelled");
  assert.notEqual(attemptStatusForIntent("canceled"), "canceled");
});

// ---------------------------------------------------------------------------
// What a church may configure
// ---------------------------------------------------------------------------

test("a church may narrow the platform's bounds but not widen them", () => {
  const tighter = normaliseAmounts({
    suggestedAmounts: [],
    minAmountCents: 500,
    maxAmountCents: 20_000,
  });
  assert.equal(tighter.ok, true);

  // Below the platform floor, and above its ceiling.
  assert.equal(
    normaliseAmounts({ suggestedAmounts: [], minAmountCents: 1, maxAmountCents: 20_000 }).ok,
    false,
  );
  assert.equal(
    normaliseAmounts({
      suggestedAmounts: [],
      minAmountCents: PLATFORM_MIN_CENTS,
      maxAmountCents: PLATFORM_MAX_CENTS + 1,
    }).ok,
    false,
  );
});

test("an inverted range is refused rather than silently swapped", () => {
  // Swapping would publish bounds the church did not choose, which is worse
  // than making them fix it.
  assert.equal(
    normaliseAmounts({ suggestedAmounts: [], minAmountCents: 10_000, maxAmountCents: 500 }).ok,
    false,
  );
});

test("a suggested amount a visitor could not give is dropped", () => {
  // A chip that fails validation the moment it is tapped is a broken button.
  const result = normaliseAmounts({
    suggestedAmounts: [100, 2_500, 5_000, 999_999],
    minAmountCents: 1_000,
    maxAmountCents: 10_000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.suggestedAmounts, [2_500, 5_000]);
});

test("suggested amounts are deduplicated, sorted and bounded in number", () => {
  const result = normaliseAmounts({
    suggestedAmounts: [10_000, 2_500, 2_500, 5_000, 1_000, 7_500, 20_000, 30_000, 40_000],
    minAmountCents: 100,
    maxAmountCents: 500_000,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.suggestedAmounts,
    [1_000, 2_500, 5_000, 7_500, 10_000, 20_000],
  );
  assert.equal(result.value.suggestedAmounts.length, MAX_SUGGESTED_AMOUNTS);
});

test("a fractional or non-finite amount cannot reach the database", () => {
  const fractional = normaliseAmounts({
    suggestedAmounts: [2_500.7],
    minAmountCents: 100.9,
    maxAmountCents: 10_000.2,
  });
  assert.equal(fractional.ok, true);
  if (!fractional.ok) return;
  // Truncated to whole cents. A fractional cent is not a thing Stripe accepts.
  assert.equal(Number.isInteger(fractional.value.minAmountCents), true);
  assert.equal(Number.isInteger(fractional.value.maxAmountCents), true);
  assert.deepEqual(fractional.value.suggestedAmounts, [2_500]);

  assert.equal(
    normaliseAmounts({
      suggestedAmounts: [],
      minAmountCents: Number.NaN,
      maxAmountCents: 10_000,
    }).ok,
    false,
  );
  assert.equal(
    normaliseAmounts({
      suggestedAmounts: [],
      minAmountCents: 100,
      maxAmountCents: Number.POSITIVE_INFINITY,
    }).ok,
    false,
  );
});
