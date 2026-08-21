import assert from "node:assert/strict";
import test from "node:test";
import { safeStripeFailure, stripeRetryAt } from "@/lib/stripe/webhook-state";

test("Stripe retry schedule is bounded and deterministic", () => {
  const now = Date.parse("2026-08-19T00:00:00.000Z");
  assert.equal(
    stripeRetryAt(1, now),
    new Date(now + 60_000).toISOString(),
  );
  assert.equal(
    stripeRetryAt(99, now),
    new Date(now + 60 * 60 * 1000).toISOString(),
  );
});

test("persisted Stripe failures contain no message or payment body", () => {
  const failure = safeStripeFailure(
    new TypeError("card details and webhook payload must not persist"),
  );
  assert.deepEqual(failure, { category: "handler", code: "TypeError" });
});
