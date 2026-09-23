import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  APP_CONFIRM_PATH,
  appConfirmRedirect,
  buildAppCallbackLink,
  readAppCallback,
} from "../../lib/auth/app-confirm-link";
import { FAITHFORM_MOBILE_CALLBACK } from "../../lib/auth/auth-redirects";

// ---------------------------------------------------------------------------
// The shared contract
// ---------------------------------------------------------------------------
//
// `confirmHandoff` and the `handoff` vectors in
// `contracts/faithform/v1/auth-callback.json`. The Swift and Kotlin suites
// read the same bytes for the half they own — which URL each build registers —
// and this suite owns the other half: what the page does with what arrives.

const contract = JSON.parse(
  readFileSync(
    join(process.cwd(), "contracts/faithform/v1/auth-callback.json"),
    "utf8",
  ),
) as {
  faithform: { canonical: string };
  confirmHandoff: { path: string; environments: Record<string, string> };
  dashboard: { callbackPath: string };
  vectors: {
    handoff: { search: string; hash: string; deepLink: string; why: string }[];
    handoffRefused: { search: string; hash: string; why: string }[];
  };
};

/** Runs a body with NEXT_PUBLIC_SITE_URL set, then restores it. */
function withSiteUrl<T>(value: string, body: () => T): T {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = value;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
}

// ---------------------------------------------------------------------------
// Where the confirmation email lands
// ---------------------------------------------------------------------------

test("the landing path is the contract's, verbatim", () => {
  assert.equal(APP_CONFIRM_PATH, contract.confirmHandoff.path);
});

test("every environment's landing page is derived from that environment's origin", () => {
  for (const [name, expected] of Object.entries(contract.confirmHandoff.environments)) {
    const origin = expected.slice(0, -APP_CONFIRM_PATH.length);
    assert.equal(withSiteUrl(origin, appConfirmRedirect), expected, name);
    // A configured origin with a trailing slash must not double up.
    assert.equal(withSiteUrl(`${origin}/`, appConfirmRedirect), expected, name);
  }
});

test("the landing page is https, never the custom scheme", () => {
  // The whole reason this page exists: a `302` into `faithform://` is what
  // browsers refused, leaving a confirmed account looking like a broken one.
  for (const expected of Object.values(contract.confirmHandoff.environments)) {
    assert.ok(expected.startsWith("http"), expected);
    assert.ok(!expected.includes("faithform://"), expected);
  }
});

test("the landing page is not the dashboard's callback", () => {
  // Two surfaces, two destinations. A visitor confirming from the app must
  // never be delivered to the staff dashboard, which is the original misroute.
  assert.notEqual(APP_CONFIRM_PATH, contract.dashboard.callbackPath);
});

// ---------------------------------------------------------------------------
// What the page hands on
// ---------------------------------------------------------------------------

test("every handoff vector produces exactly its deep link", () => {
  for (const vector of contract.vectors.handoff) {
    assert.equal(
      buildAppCallbackLink(vector.search, vector.hash),
      vector.deepLink,
      vector.why,
    );
  }
});

test("every refused vector hands on nothing at all", () => {
  for (const vector of contract.vectors.handoffRefused) {
    assert.equal(buildAppCallbackLink(vector.search, vector.hash), null, vector.why);
  }
});

test("a code is a code, a failure is a failure, and nothing is nothing", () => {
  assert.equal(readAppCallback("?code=9c1e02f3-4d69-4b8c", "").kind, "code");
  assert.equal(readAppCallback("", "#error_code=otp_expired").kind, "failure");
  assert.equal(readAppCallback("", "").kind, "nothing");
});

test("a reported failure outranks a code left beside it", () => {
  // A provider that says "expired" and leaves a stale code on the URL must not
  // read as a success — the app would exchange it and fail obscurely.
  const result = readAppCallback(
    "?code=9c1e02f3-4d69-4b8c&error=access_denied&error_code=otp_expired",
    "",
  );
  assert.equal(result.kind, "failure");
  assert.equal(result.link, `${FAITHFORM_MOBILE_CALLBACK}#error=access_denied&error_code=otp_expired`);
});

// ---------------------------------------------------------------------------
// Nothing but our own alphabet shapes the deep link
// ---------------------------------------------------------------------------

test("provider wording never crosses into the deep link", () => {
  const link = buildAppCallbackLink(
    "?error=access_denied&error_description=Email+link+for+pat%40example.org+has+expired",
    "",
  );
  assert.equal(link, `${FAITHFORM_MOBILE_CALLBACK}#error=access_denied`);
  assert.ok(!link!.includes("example.org"));
});

test("an error name outside the alphabet is dropped, not forwarded", () => {
  for (const injected of [
    "../../evil",
    "otp expired",
    "OTP_EXPIRED",
    "a".repeat(65),
    "otp_expired&code=stolen",
    "",
  ]) {
    const link = buildAppCallbackLink(
      `?error=access_denied&error_code=${encodeURIComponent(injected)}`,
      "",
    );
    assert.equal(link, `${FAITHFORM_MOBILE_CALLBACK}#error=access_denied`, injected);
  }
});

test("a code outside the contract bounds is never handed to the app", () => {
  for (const injected of [
    "short",
    "a".repeat(513),
    "9c1e02f3 4d69",
    "9c1e02f3/../evil",
    "9c1e02f3&next=/dashboard",
    "9c1e02f3#fragment",
  ]) {
    assert.equal(
      buildAppCallbackLink(`?code=${encodeURIComponent(injected)}`, ""),
      null,
      injected,
    );
  }
});

test("a destination is never taken from the arriving link", () => {
  // The page is a courier for a code and nothing else. No parameter on the way
  // in may steer where it goes on the way out.
  for (const search of [
    "?code=9c1e02f3-4d69-4b8c&redirect_to=https%3A%2F%2Fevil.example",
    "?code=9c1e02f3-4d69-4b8c&next=%2F%2Fevil.example",
  ]) {
    assert.equal(
      buildAppCallbackLink(search, ""),
      `${FAITHFORM_MOBILE_CALLBACK}?code=9c1e02f3-4d69-4b8c`,
      search,
    );
  }
});
