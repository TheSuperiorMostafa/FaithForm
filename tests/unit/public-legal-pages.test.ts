import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { NextRequest } from "next/server";

import { routeGate } from "../../lib/auth/route-access";
import {
  LEGAL_PATHS,
  PRIVACY_VERSION,
  SUPPORT_EMAIL,
  TERMS_VERSION,
  formatPolicyDate,
} from "../../lib/legal/policy-versions";
import { rewriteChurchSite } from "../../lib/sites/tenant";

// ---------------------------------------------------------------------------
// Reachable signed-out
// ---------------------------------------------------------------------------
//
// Both stores link to these pages from a listing, and Google Play checks the
// account-deletion URL from a browser that has never signed in. A redirect to
// /login in front of any of them reads as "no policy".

const LEGAL_ROUTES = Object.values(LEGAL_PATHS);

test("the store-required pages are the legal routes", () => {
  // Four, since both stores also list a Support URL and App Review opens it.
  assert.deepEqual([...LEGAL_ROUTES].sort(), [
    "/account-deletion",
    "/privacy",
    "/support",
    "/terms",
  ]);
});

test("middleware treats every legal page as public", () => {
  for (const path of LEGAL_ROUTES) {
    assert.equal(routeGate(path), "public", path);
    // An in-page anchor or a trailing slash is the same page.
    assert.equal(routeGate(`${path}/`), "public", `${path}/`);
  }
});

test("the gated areas are still gated", () => {
  // The other half: making the default public must not have unguarded these.
  assert.equal(routeGate("/dashboard"), "signed_in");
  assert.equal(routeGate("/dashboard/giving"), "signed_in");
  assert.equal(routeGate("/admin"), "platform_admin");
  assert.equal(routeGate("/admin/churches/abc"), "platform_admin");
  assert.equal(routeGate("/onboarding"), "onboarding");
  for (const open of ["/", "/login", "/give/grace", "/live/grace", "/auth/confirm", "/set-password"]) {
    assert.equal(routeGate(open), "public", open);
  }
});

test("middleware takes its gating from routeGate and nowhere else", () => {
  // A second, inline copy of the rules is how a path ends up gated in one
  // place and documented as public in the other.
  const middleware = readFileSync("lib/supabase/middleware.ts", "utf8");
  assert.match(middleware, /const gate = routeGate\(request\.nextUrl\.pathname\)/);
  for (const inline of ['startsWith("/dashboard")', 'startsWith("/admin")', 'startsWith("/onboarding")']) {
    assert.ok(!middleware.includes(inline), `middleware gates ${inline} inline`);
  }
});

test("the matcher runs middleware on the legal pages, so the gate above is what decides", () => {
  const source = readFileSync("middleware.ts", "utf8");
  const matcher = /matcher:\s*\[\s*"([^"]+)"/.exec(source)?.[1];
  assert.ok(matcher, "the matcher moved and this test went stale");
  const pattern = new RegExp(`^${matcher.replace(/\\\\/g, "\\")}$`);
  // Non-vacuity: the translated pattern still excludes what the matcher excludes.
  assert.equal(pattern.test("/faithform-logo.png"), false);
  assert.equal(pattern.test("/_next/static/chunk.js"), false);
  for (const path of LEGAL_ROUTES) {
    assert.ok(pattern.test(path), `${path} is outside the matcher`);
  }
});

test("on FaithForm's own host a legal page is never rewritten into a church site", async () => {
  const previous = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SITE_ROOT_HOST: process.env.NEXT_PUBLIC_SITE_ROOT_HOST,
  };
  process.env.NEXT_PUBLIC_SITE_URL = "https://faithform.io";
  process.env.NEXT_PUBLIC_SITE_ROOT_HOST = "faithform.io";
  try {
    for (const path of LEGAL_ROUTES) {
      const request = new NextRequest(`https://faithform.io${path}`, {
        headers: { host: "faithform.io" },
      });
      assert.equal(await rewriteChurchSite(request), null, path);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the pages ask nothing of a session, so nothing can redirect a visitor away", () => {
  for (const [file, route] of [
    ["app/privacy/page.tsx", LEGAL_PATHS.privacy],
    ["app/terms/page.tsx", LEGAL_PATHS.terms],
    ["app/account-deletion/page.tsx", LEGAL_PATHS.accountDeletion],
  ] as const) {
    assert.ok(existsSync(file), `${route} has no page`);
    const page = readFileSync(file, "utf8");
    for (const signedIn of ["@/lib/supabase/server", "getUser", "getClaims", "redirect(", "requireSuperAdmin", "getChurchAuth"]) {
      assert.ok(!page.includes(signedIn), `${file} uses ${signedIn}`);
    }
    assert.match(page, /export const metadata: Metadata = \{\s*title: "[^"]+ \| FaithForm"/);
    assert.match(page, /LEGAL REVIEW PENDING/);
  }
});

test("the support page is reachable signed-out and names a way to reach a person", () => {
  // Not a policy, so no version and no legal review — but a reviewer opens it
  // from the listing, and guideline 1.2 wants the contact on it.
  const file = "app/support/page.tsx";
  assert.ok(existsSync(file), `${LEGAL_PATHS.support} has no page`);
  const page = readFileSync(file, "utf8");
  for (const signedIn of ["@/lib/supabase/server", "getUser", "getClaims", "redirect(", "requireSuperAdmin", "getChurchAuth"]) {
    assert.ok(!page.includes(signedIn), `${file} uses ${signedIn}`);
  }
  assert.match(page, /export const metadata: Metadata = \{\s*title: "[^"]+ \| FaithForm"/);
  assert.ok(page.includes("SUPPORT_EMAIL"), "the support page names no address");
});

// ---------------------------------------------------------------------------
// One version, printed and required
// ---------------------------------------------------------------------------

test("the apps require exactly the versions the pages print", () => {
  const service = readFileSync("lib/mobile/v1/account-service.ts", "utf8");
  assert.match(service, /export const REQUIRED_TERMS_VERSION = TERMS_VERSION;/);
  assert.match(service, /export const REQUIRED_PRIVACY_VERSION = PRIVACY_VERSION;/);
  // No second literal hiding anywhere in the service.
  assert.doesNotMatch(service, /REQUIRED_(TERMS|PRIVACY)_VERSION = "/);

  assert.match(readFileSync("app/terms/page.tsx", "utf8"), /formatPolicyDate\(TERMS_VERSION\)/);
  assert.match(readFileSync("app/privacy/page.tsx", "utf8"), /formatPolicyDate\(PRIVACY_VERSION\)/);
});

test("the current versions are the ones every accepted consent was recorded against", () => {
  // Moving either is a re-prompt for every person on both apps. That may be
  // exactly right, but it should never happen by accident in a refactor.
  assert.equal(TERMS_VERSION, "2026-09-20");
  assert.equal(PRIVACY_VERSION, "2026-09-20");
});

test("an effective date prints from the string, never through a time zone", () => {
  assert.equal(formatPolicyDate("2026-08-01"), "August 1, 2026");
  assert.equal(formatPolicyDate("2027-01-31"), "January 31, 2027");
  assert.equal(formatPolicyDate("2026-12-09"), "December 9, 2026");
  for (const bad of ["2026-8-1", "August 1, 2026", "2026-13-01", "2026-00-10", "2026-01-32", ""]) {
    assert.throws(() => formatPolicyDate(bad), bad);
  }
});

test("support is reachable from every legal page and the sign-in page links the policies", () => {
  assert.equal(SUPPORT_EMAIL, "support@faithform.io");
  const frame = readFileSync("components/legal/legal-document.tsx", "utf8");
  assert.match(frame, /mailto:\$\{SUPPORT_EMAIL\}/);
  for (const key of ["privacy", "terms", "accountDeletion"]) {
    assert.match(frame, new RegExp(`LEGAL_PATHS\\.${key}`), key);
  }

  // The links live in the frame shared by the sign-in page and its loading
  // state, so they are there before the form has even loaded.
  const loginPage = readFileSync("app/login/page.tsx", "utf8");
  assert.match(loginPage, /<LoginShell>/);
  const login = readFileSync("app/login/login-shell.tsx", "utf8");
  assert.match(login, /<LegalLinks \/>/);
  assert.match(login, /LEGAL_PATHS\.privacy/);
  assert.match(login, /LEGAL_PATHS\.terms/);
});
