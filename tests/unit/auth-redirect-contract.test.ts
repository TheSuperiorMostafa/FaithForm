import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DASHBOARD_CALLBACK_PATH,
  FAITHFUL_MOBILE_CALLBACK,
  dashboardEmailRedirect,
  isAllowedDashboardRedirect,
  isFaithfulMobileCallback,
} from "../../lib/auth/auth-redirects";
import { safeRedirectPath } from "../../lib/security/safe-redirect";
import { callbackDiagnosticCode } from "../../lib/auth/callback-diagnostics";
import { resolveSignedInLanding } from "../../lib/auth/signed-in-landing";

// ---------------------------------------------------------------------------
// The shared contract
// ---------------------------------------------------------------------------
//
// `contracts/faithful/v1/auth-callback.json` is read here, by the Swift suite
// (AuthCallbackTests) and by the Kotlin suite (AuthCallbackLinkTest). One set
// of bytes, three languages, so a destination cannot be widened on one
// platform and quietly stay narrow on the others.

const contract = JSON.parse(
  readFileSync(
    join(process.cwd(), "contracts/faithful/v1/auth-callback.json"),
    "utf8",
  ),
) as {
  faithful: { scheme: string; host: string; path: string; canonical: string };
  dashboard: {
    callbackPath: string;
    environments: Record<string, string>;
  };
  vectors: {
    accepted: { url: string; code: string }[];
    failures: { url: string; reason: string }[];
    rejected: { url: string; why: string }[];
    dashboardRejected: { next: string; why: string }[];
  };
};

/** Runs a body with NEXT_PUBLIC_SITE_URL set, then restores it. */
function withSiteUrl<T>(value: string | undefined, body: () => T): T {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = value;
  try {
    return body();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
    if (previousNodeEnv !== undefined) {
      Object.defineProperty(process.env, "NODE_ENV", {
        value: previousNodeEnv,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The dashboard produces only its own callback
// ---------------------------------------------------------------------------

test("the dashboard callback path is the contract's", () => {
  assert.equal(DASHBOARD_CALLBACK_PATH, contract.dashboard.callbackPath);
});

test("each environment's dashboard link is built from that environment's origin", () => {
  for (const [environment, expected] of Object.entries(
    contract.dashboard.environments,
  )) {
    const origin = new URL(expected).origin;
    withSiteUrl(origin, () => {
      assert.equal(dashboardEmailRedirect(), expected, environment);
    });
  }
});

test("a dashboard link never points at another environment", () => {
  const production = contract.dashboard.environments.production;
  const development = contract.dashboard.environments.development;

  withSiteUrl(new URL(development).origin, () => {
    assert.equal(dashboardEmailRedirect(), development);
    assert.notEqual(dashboardEmailRedirect(), production);
    // And the production callback is not an allowed destination for a
    // development build, which is what stops a local link mailing someone
    // into production.
    assert.equal(isAllowedDashboardRedirect(production), false);
    assert.equal(isAllowedDashboardRedirect(development), true);
  });
});

test("a post-auth path survives, sanitised, on the dashboard link", () => {
  withSiteUrl("https://faithform.io", () => {
    assert.equal(
      dashboardEmailRedirect("/set-password?reason=recovery"),
      "https://faithform.io/auth/callback?next=%2Fset-password%3Freason%3Drecovery",
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-surface attempts are rejected
// ---------------------------------------------------------------------------

test("the mobile callback is never an allowed dashboard destination", () => {
  withSiteUrl("https://faithform.io", () => {
    assert.equal(isAllowedDashboardRedirect(FAITHFUL_MOBILE_CALLBACK), false);
    assert.equal(
      isAllowedDashboardRedirect("faithful://auth/callback?code=abc"),
      false,
    );
  });
});

test("every dashboardRejected vector degrades to the default, never to itself", () => {
  withSiteUrl("https://faithform.io", () => {
    for (const vector of contract.vectors.dashboardRejected) {
      const resolved = safeRedirectPath(vector.next);
      assert.equal(resolved, "/dashboard", vector.why);

      const link = dashboardEmailRedirect(vector.next);
      assert.equal(
        link,
        "https://faithform.io/auth/callback?next=%2Fdashboard",
        vector.why,
      );
      // Nothing of the attempted destination survives into the emailed link.
      assert.ok(!link.includes("evil.example"), vector.why);
      assert.ok(!link.toLowerCase().includes("faithful:"), vector.why);
    }
  });
});

test("an arbitrary absolute redirect is never accepted as a dashboard one", () => {
  withSiteUrl("https://faithform.io", () => {
    for (const candidate of [
      "https://faithform.io.evil.example/auth/callback",
      "https://evil.example/auth/callback",
      "https://faithform.io/auth/callback/../evil",
      "https://faithform.io/dashboard",
      "not-a-url",
      "",
    ]) {
      assert.equal(isAllowedDashboardRedirect(candidate), false, candidate);
    }
  });
});

test("the mobile callback is recognised for what it is, in any case form", () => {
  assert.equal(isFaithfulMobileCallback(contract.faithful.canonical), true);
  assert.equal(isFaithfulMobileCallback("FAITHFUL://AUTH/callback"), true);
  assert.equal(isFaithfulMobileCallback("faithful://invite/aaaa"), false);
  assert.equal(
    isFaithfulMobileCallback(contract.dashboard.environments.production),
    false,
  );
});

// ---------------------------------------------------------------------------
// The signed-in landing decision
// ---------------------------------------------------------------------------
//
// The blank page was a redirect loop: /login sent every authenticated user to
// /dashboard, and /dashboard sent everyone without a church membership back to
// /login. Making the decision total is what ends it.

test("a staff account with a church lands on the dashboard", () => {
  assert.deepEqual(
    resolveSignedInLanding({ hasChurchMembership: true, isPlatformAdmin: false }),
    { kind: "dashboard" },
  );
});

test("a visitor account gets a page, never another redirect", () => {
  assert.deepEqual(
    resolveSignedInLanding({ hasChurchMembership: false, isPlatformAdmin: false }),
    { kind: "no_dashboard_access" },
  );
});

test("a platform admin without a church still reaches admin", () => {
  assert.deepEqual(
    resolveSignedInLanding({ hasChurchMembership: false, isPlatformAdmin: true }),
    { kind: "admin" },
  );
});

test("no input combination is left without a destination", () => {
  for (const hasChurchMembership of [true, false]) {
    for (const isPlatformAdmin of [true, false]) {
      const landing = resolveSignedInLanding({
        hasChurchMembership,
        isPlatformAdmin,
      });
      assert.ok(
        ["dashboard", "admin", "no_dashboard_access"].includes(landing.kind),
        `${hasChurchMembership}/${isPlatformAdmin}`,
      );
    }
  }
});

test("visitor status alone never becomes dashboard access", () => {
  // The fix routes people; it must not grant anything. A visitor is only ever
  // shown the no-access state, whatever else is true of them.
  assert.notEqual(
    resolveSignedInLanding({ hasChurchMembership: false, isPlatformAdmin: false })
      .kind,
    "dashboard",
  );
});

// ---------------------------------------------------------------------------
// Diagnostics stay safe
// ---------------------------------------------------------------------------

test("a recognised provider reason is logged verbatim", () => {
  assert.equal(
    callbackDiagnosticCode(new URLSearchParams("error_code=otp_expired")),
    "otp_expired",
  );
  assert.equal(
    callbackDiagnosticCode(new URLSearchParams("error=access_denied")),
    "access_denied",
  );
});

test("a missing reason is its own code, not an empty string", () => {
  assert.equal(callbackDiagnosticCode(new URLSearchParams("")), "no_code");
});

test("nothing injectable or personal survives into a log line", () => {
  for (const raw of [
    "Email link is invalid or has expired",
    "otp_expired\nINFO fake log line",
    "person@example.org",
    "a".repeat(200),
    "../../etc/passwd",
    "<script>alert(1)</script>",
  ]) {
    const params = new URLSearchParams();
    params.set("error_code", raw);
    const code = callbackDiagnosticCode(params);
    assert.equal(code, "unrecognised", raw);
    assert.ok(!code.includes("\n"));
    assert.ok(!code.includes("@"));
  }
});
