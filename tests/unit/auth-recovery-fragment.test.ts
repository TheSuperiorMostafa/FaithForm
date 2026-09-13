import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  callbackNeedsFragmentHandoff,
  isAuthFragment,
  readRecoveryFragment,
} from "../../lib/auth/recovery-fragment";

// ---------------------------------------------------------------------------
// A reset link requested by the phone apps
// ---------------------------------------------------------------------------
//
// The apps call `/auth/v1/recover` without a PKCE challenge, so Supabase
// answers on the implicit flow: the session comes back in the URL fragment,
// which the server-side callback never sees. These pin how the page that can
// see it reads it.

const ACCESS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl";
const REFRESH_TOKEN = "v1q9xZt3kR2m";

/** Shaped the way Supabase writes it, in Supabase's own parameter order. */
function supabaseFragment(overrides: Record<string, string | null> = {}): string {
  const values: Record<string, string | null> = {
    access_token: ACCESS_TOKEN,
    expires_at: "1789000000",
    expires_in: "3600",
    refresh_token: REFRESH_TOKEN,
    token_type: "bearer",
    type: "recovery",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) params.set(key, value);
  }
  return `#${params.toString()}`;
}

test("a recovery fragment yields both tokens", () => {
  assert.deepEqual(readRecoveryFragment(supabaseFragment()), {
    kind: "recovery",
    accessToken: ACCESS_TOKEN,
    refreshToken: REFRESH_TOKEN,
  });
});

test("the leading # is optional, so location.hash and a bare string agree", () => {
  assert.deepEqual(
    readRecoveryFragment(supabaseFragment().slice(1)),
    readRecoveryFragment(supabaseFragment()),
  );
});

test("only a recovery session is accepted — not a magic link, a signup or an invite", () => {
  for (const type of ["magiclink", "signup", "invite", "email_change", "RECOVERY", ""]) {
    assert.deepEqual(
      readRecoveryFragment(supabaseFragment({ type })),
      { kind: "invalid" },
      type,
    );
  }
  assert.deepEqual(readRecoveryFragment(supabaseFragment({ type: null })), {
    kind: "invalid",
  });
});

test("a session missing either token is not a session", () => {
  assert.equal(readRecoveryFragment(supabaseFragment({ access_token: null })).kind, "invalid");
  assert.equal(readRecoveryFragment(supabaseFragment({ refresh_token: null })).kind, "invalid");
  assert.equal(readRecoveryFragment(supabaseFragment({ access_token: "" })).kind, "invalid");
  assert.equal(readRecoveryFragment(supabaseFragment({ refresh_token: "" })).kind, "invalid");
});

test("a reported failure wins even when tokens are present", () => {
  // Supabase reports an expired or spent link in the fragment as well.
  for (const key of ["error", "error_code", "error_description"]) {
    assert.equal(
      readRecoveryFragment(supabaseFragment({ [key]: "otp_expired" })).kind,
      "invalid",
      key,
    );
  }
  assert.equal(
    readRecoveryFragment(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    ).kind,
    "invalid",
  );
});

test("a truncated or malformed token is refused before it reaches setSession", () => {
  for (const accessToken of [
    "not-a-jwt",
    "only.two",
    "has spaces.in.it",
    "a.b.c.d",
    `${"a".repeat(9000)}.b.c`,
  ]) {
    assert.equal(
      readRecoveryFragment(supabaseFragment({ access_token: accessToken })).kind,
      "invalid",
      accessToken.slice(0, 40),
    );
  }
  for (const refreshToken of ["has space", "semi;colon", "x".repeat(2000)]) {
    assert.equal(
      readRecoveryFragment(supabaseFragment({ refresh_token: refreshToken })).kind,
      "invalid",
      refreshToken.slice(0, 40),
    );
  }
});

test("nothing at all is invalid, never an exception", () => {
  for (const hash of [undefined, null, "", "#", "#type=recovery", "#section-2"]) {
    assert.deepEqual(readRecoveryFragment(hash), { kind: "invalid" }, String(hash));
  }
});

// ---------------------------------------------------------------------------
// Recognising an auth fragment where a stripped link lands
// ---------------------------------------------------------------------------

test("a session or a reported failure is an auth fragment", () => {
  assert.equal(isAuthFragment(supabaseFragment()), true);
  assert.equal(isAuthFragment(supabaseFragment({ type: "magiclink" })), true);
  assert.equal(isAuthFragment("#error=access_denied&error_code=otp_expired"), true);
  assert.equal(isAuthFragment("#error_description=Email+link+is+invalid"), true);
});

test("an ordinary anchor is not, so the sign-in page never bounces on one", () => {
  for (const hash of [undefined, null, "", "#", "#main", "#password", "#error"]) {
    assert.equal(isAuthFragment(hash), false, String(hash));
  }
});

// ---------------------------------------------------------------------------
// When the server callback hands off
// ---------------------------------------------------------------------------

test("a callback with nothing on the query string is handed to /auth/confirm", () => {
  assert.equal(callbackNeedsFragmentHandoff(new URLSearchParams("")), true);
  // The app's `next` is not an instruction the server can act on by itself.
  assert.equal(
    callbackNeedsFragmentHandoff(
      new URLSearchParams("next=%2Fset-password%3Freason%3Drecovery"),
    ),
    true,
  );
});

test("a code is exchanged on the server, never handed off", () => {
  assert.equal(callbackNeedsFragmentHandoff(new URLSearchParams("code=abc")), false);
  assert.equal(
    callbackNeedsFragmentHandoff(new URLSearchParams("code=abc&next=%2Fdashboard")),
    false,
  );
});

test("a failure the provider already reported is logged on the server, never handed off", () => {
  for (const query of [
    "error=access_denied",
    "error_code=otp_expired",
    "error_description=Email+link+is+invalid",
    "error=access_denied&error_code=otp_expired&error_description=x",
  ]) {
    assert.equal(callbackNeedsFragmentHandoff(new URLSearchParams(query)), false, query);
  }
});

// ---------------------------------------------------------------------------
// The wiring, pinned by source
// ---------------------------------------------------------------------------
//
// The route needs a live Supabase client and the page needs a browser, so the
// order of operations that makes this safe is asserted by reading them.

const route = readFileSync("app/auth/callback/route.ts", "utf8");
const page = readFileSync("app/auth/confirm/confirm-from-fragment.tsx", "utf8");

test("the code path runs first, the handoff second, the failure last", () => {
  const exchange = route.indexOf("exchangeCodeForSession(code)");
  const handoff = route.indexOf("callbackNeedsFragmentHandoff(searchParams)");
  // The redirect itself, not a comment that mentions the destination.
  const failure = route.indexOf("redirectTo(`${origin}/login?error=auth`)");
  assert.ok(exchange > 0 && handoff > 0 && failure > 0, "all three branches are present");
  assert.ok(exchange < handoff, "a code must be exchanged before any handoff");
  assert.ok(handoff < failure, "an empty callback must reach the fragment reader");
  // The failure is still logged with the validated diagnostic.
  assert.match(route, /callbackDiagnosticCode\(searchParams\)/);
});

test("the handoff forwards nothing from the query string", () => {
  // The fragment carries itself across the redirect; nothing else needs to,
  // and `next` in particular must not become a destination.
  assert.match(route, /redirectTo\(`\$\{origin\}\/auth\/confirm`\)/);
});

test("the page strips the tokens from the address bar before building a client", () => {
  const read = page.indexOf("readRecoveryFragment(window.location.hash)");
  const strip = page.indexOf("window.history.replaceState(");
  const client = page.indexOf("createClient()");
  const setSession = page.indexOf(".setSession(");
  assert.ok(read > 0 && strip > 0 && client > 0 && setSession > 0);
  assert.ok(read < strip, "the fragment is read before it is removed");
  assert.ok(strip < client, "the client must not see the fragment");
  assert.ok(client < setSession);
  // And the stripped URL is rebuilt from path and query only.
  assert.match(page, /`\$\{window\.location\.pathname\}\$\{window\.location\.search\}`/);
});

test("a recovery session lands on the reset screen; anything else on the sign-in error", () => {
  assert.match(page, /"\/set-password\?reason=recovery"/);
  assert.match(page, /"\/login\?error=auth"/);
  // No destination is ever read out of the link.
  assert.doesNotMatch(page, /searchParams|get\("next"\)|redirect_to/);
  // And nothing on this path logs a token.
  assert.doesNotMatch(page, /console\./);
});
