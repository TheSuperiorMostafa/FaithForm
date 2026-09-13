import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_GIVING_CHANNELS,
  givingChannelsFor,
} from "@/lib/giving/v1/giving-channels";
import { attemptStatusForIntent } from "@/lib/giving/v1/payment-provider";
import { getGivePageUrl } from "@/lib/site-url";
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

// ---------------------------------------------------------------------------
// Which channel a phone may use
// ---------------------------------------------------------------------------
//
// Apple allows an in-app donation without In-App Purchase only for a nonprofit
// it has approved (guideline 3.2.1(vi)). The approval is a per-church fact from
// migration 0072; everything else about the decision is here.

/** Runs a body with the give-URL environment pinned, then restores it. */
function withGiveEnv<T>(env: Record<string, string | undefined>, body: () => T): T {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(env);
  try {
    return body();
  } finally {
    apply(previous);
  }
}

const PRODUCTION_GIVE_ENV = {
  NEXT_PUBLIC_SITE_URL: "https://faithform.io",
  NEXT_PUBLIC_GIVE_USE_DEDICATED_HOST: undefined,
  NEXT_PUBLIC_GIVE_HOST: undefined,
};

test("a church that cannot be given to offers neither channel", () => {
  // Not "approved, but nowhere to go": an approval must never read as open for
  // giving on its own, and a closed church has no give page worth opening.
  assert.deepEqual(givingChannelsFor(null), {
    applePayApproved: false,
    webGiveUrl: null,
  });
  assert.deepEqual(givingChannelsFor(null), NO_GIVING_CHANNELS);
});

test("an unapproved church still gets its web give page", () => {
  withGiveEnv(PRODUCTION_GIVE_ENV, () => {
    assert.deepEqual(
      givingChannelsFor({ slug: "grace-church", applePayDonationsApproved: false }),
      {
        applePayApproved: false,
        webGiveUrl: "https://faithform.io/give/grace-church",
      },
    );
  });
});

test("an approved church may use Apple Pay and keeps the web page as a fallback", () => {
  withGiveEnv(PRODUCTION_GIVE_ENV, () => {
    assert.deepEqual(
      givingChannelsFor({ slug: "grace-church", applePayDonationsApproved: true }),
      {
        applePayApproved: true,
        webGiveUrl: "https://faithform.io/give/grace-church",
      },
    );
  });
});

test("only a literal true approves — a malformed value costs a hop, not the listing", () => {
  for (const value of [undefined, null, "true", 1] as unknown[]) {
    const channels = givingChannelsFor({
      slug: "grace-church",
      applePayDonationsApproved: value as boolean,
    });
    assert.equal(channels.applePayApproved, false, String(value));
  }
});

test("the web give URL is the same one the dashboard prints", () => {
  // One helper for the QR code, the settings card and the app, so a church's
  // printed link and the app's link cannot drift apart — including on a
  // dedicated give host.
  withGiveEnv(
    {
      NEXT_PUBLIC_SITE_URL: "https://faithform.io",
      NEXT_PUBLIC_GIVE_USE_DEDICATED_HOST: "true",
      NEXT_PUBLIC_GIVE_HOST: "give.faithform.io",
    },
    () => {
      const channels = givingChannelsFor({
        slug: "grace-church",
        applePayDonationsApproved: false,
      });
      assert.equal(channels.webGiveUrl, getGivePageUrl("grace-church"));
      assert.equal(channels.webGiveUrl, "https://give.faithform.io/grace-church");
    },
  );
});

test("the closed-church result is a fresh object, never the shared constant", () => {
  const first = givingChannelsFor(null);
  (first as { applePayApproved: boolean }).applePayApproved = true;
  assert.equal(givingChannelsFor(null).applePayApproved, false);
  assert.equal(NO_GIVING_CHANNELS.applePayApproved, false);
});
