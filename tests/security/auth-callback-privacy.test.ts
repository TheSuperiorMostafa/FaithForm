import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const IOS_AUTH = "apps/faithful-ios/Sources/FaithfulKit/Session/SupabaseAuth.swift";
const IOS_CALLBACK = "apps/faithful-ios/Sources/FaithfulKit/Session/AuthCallback.swift";
const IOS_MODEL = "apps/faithful-ios/Sources/FaithfulKit/Features/AuthModel.swift";
const IOS_ROOT = "apps/faithful-ios/App/RootModel.swift";
const ANDROID_AUTH =
  "apps/faithful-android/core/network/src/main/kotlin/io/faithform/faithful/network/SupabaseAuthClient.kt";
const ANDROID_CALLBACK =
  "apps/faithful-android/core/navigation/src/main/kotlin/io/faithform/faithful/navigation/AuthCallbackLink.kt";
const ANDROID_VIEWMODEL =
  "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/AppViewModel.kt";
const WEB_CALLBACK = "app/auth/callback/route.ts";

// ---------------------------------------------------------------------------
// Redirects are configuration, never input
// ---------------------------------------------------------------------------

test("mobile signup sends only the compiled-in callback, never a value from a link", () => {
  const ios = read(IOS_AUTH);
  // The redirect comes from configuration and is the only source of the
  // `redirect_to` parameter.
  assert.match(ios, /redirect_to=\\\(encoded\)/);
  assert.match(ios, /configuration\.signUpRedirectURL/);

  const android = read(ANDROID_AUTH);
  assert.match(android, /config\.signUpRedirect/);
  assert.match(android, /"redirect_to=" \+ urlEncode\(redirect\)/);

  // Neither client reads a destination out of the callback it receives.
  for (const source of [read(IOS_CALLBACK), read(ANDROID_CALLBACK)]) {
    assert.doesNotMatch(source, /redirect_to/);
    assert.doesNotMatch(source, /redirect_uri/);
  }
});

test("the exchange targets the configured provider, not anything the link carried", () => {
  const ios = read(IOS_AUTH);
  const android = read(ANDROID_AUTH);
  // Both build the URL from `configuration.url` / `config.url` through their
  // existing post() helper; neither ever constructs one from a callback.
  assert.match(ios, /path: "auth\/v1\/token",\s*\n\s*query: "grant_type=pkce"/);
  assert.match(android, /"auth\/v1\/token",\s*\n\s*query = "grant_type=pkce"/);
  assert.doesNotMatch(ios, /URL\(string: code/);
  assert.doesNotMatch(android, /URI\(code/);
});

test("the dashboard callback never forwards to an arbitrary destination", () => {
  const route = read(WEB_CALLBACK);
  assert.match(route, /safeRedirectPath\(searchParams\.get\("next"\)\)/);
  // Every redirect is built on the request's own origin.
  const redirects = [...route.matchAll(/redirectTo\(`([^`]*)`\)/g)].map((m) => m[1]);
  assert.ok(redirects.length >= 3);
  for (const target of redirects) {
    assert.ok(target.startsWith("${origin}"), target);
  }
});

// ---------------------------------------------------------------------------
// Nothing sensitive is logged, cached, or shown
// ---------------------------------------------------------------------------

test("no client logs a token, a code, a verifier, or an address", () => {
  const sources = [
    read(IOS_AUTH),
    read(IOS_CALLBACK),
    read(IOS_MODEL),
    read(IOS_ROOT),
    read(ANDROID_AUTH),
    read(ANDROID_CALLBACK),
    read(ANDROID_VIEWMODEL),
  ];

  for (const source of sources) {
    // No ad-hoc printing at all on these paths.
    assert.doesNotMatch(source, /\bprint\(/);
    assert.doesNotMatch(source, /\bdebugPrint\(/);
    assert.doesNotMatch(source, /System\.out|println\(/);
    assert.doesNotMatch(source, /Log\.[dveiw]\(/);
  }

  // The one logging call on the iOS path takes a StaticString event name, so
  // an interpolated secret cannot be passed to it.
  assert.match(read(IOS_ROOT), /log\.event\("auth_callback_ignored_signed_in"\)/);
  assert.match(read(IOS_ROOT), /log\.failure\(error\.code, requestId: error\.requestId\)/);
  assert.doesNotMatch(read(IOS_ROOT), /log\.event\("\\\(/);
});

test("the web callback logs a validated code and never provider wording", () => {
  const route = read(WEB_CALLBACK);
  assert.match(route, /callbackDiagnosticCode\(searchParams\)/);
  // Not the raw parameter, and not the exchange error object.
  assert.doesNotMatch(route, /console\.\w+\([^)]*searchParams\.get/);
  assert.doesNotMatch(route, /console\.\w+\([^)]*error\.message/);
  assert.doesNotMatch(route, /console\.\w+\([^)]*\bcode\b/);

  const diagnostics = read("lib/auth/callback-diagnostics.ts");
  assert.match(diagnostics, /\^\[a-z\]\[a-z0-9_\]\{0,39\}\$/);
});

test("the code never survives into the post-exchange URL", () => {
  const route = read(WEB_CALLBACK);
  // No redirect target interpolates the code or the raw query string.
  assert.doesNotMatch(route, /redirectTo\(`[^`]*\$\{code\}/);
  assert.doesNotMatch(route, /redirectTo\(`[^`]*searchParams/);
  // And the response that carried it is not cacheable.
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
});

test("provider error bodies never reach a person on any platform", () => {
  // iOS and Android decode the provider's error only to pick a typed kind.
  const ios = read(IOS_AUTH);
  assert.match(ios, /throw AuthFailure\(kind: \.linkExpired, message: L\.authErrorLinkExpired\)/);
  assert.doesNotMatch(ios, /message: decoded\?\./);
  assert.doesNotMatch(ios, /message: text/);

  const android = read(ANDROID_AUTH);
  assert.match(android, /throw AuthException\(AuthException\.Kind\.LINK_EXPIRED\)/);
  // AuthException carries a kind, never a provider string.
  assert.match(android, /class AuthException\(val kind: Kind\) : Exception\(kind\.name\)/);
});

test("the verifier is never sent, only its hash", () => {
  const ios = read(IOS_AUTH);
  assert.match(ios, /body\["code_challenge"\] = PKCE\.challenge\(for: verifier\)/);
  assert.doesNotMatch(ios, /body\["code_challenge"\] = verifier/);
  // The verifier appears in exactly one outgoing field, the exchange itself.
  assert.match(ios, /"code_verifier": verifier/);

  const android = read(ANDROID_AUTH);
  assert.match(android, /code_challenge = Pkce\.challenge\(verifier\)/);
  assert.match(android, /PkceExchange\(code, verifier\)/);
});

test("credential material is stored only in the platform's secure store", () => {
  const ios = read(IOS_CALLBACK);
  assert.match(ios, /store: SecureStoring/);
  assert.doesNotMatch(ios, /UserDefaults/);

  const container =
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/session/AppContainer.kt";
  const source = read(container);
  // The verifier store writes through `secureStore`, which is the
  // EncryptedSharedPreferences instance built above it.
  assert.match(source, /object : CodeVerifierStore \{[\s\S]*?secureStore\.edit\(\)/);
  assert.match(source, /EncryptedSharedPreferences\.create/);
  assert.doesNotMatch(source, /getSharedPreferences\(/);
});

// ---------------------------------------------------------------------------
// The dashboard grants nothing new
// ---------------------------------------------------------------------------

test("the visitor no-access page grants no dashboard access and creates no membership", () => {
  const page = read("app/login/page.tsx");
  assert.match(page, /resolveSignedInLanding/);
  assert.match(page, /NoDashboardAccess/);
  // No writes of any kind on this path.
  assert.doesNotMatch(page, /\.insert\(/);
  assert.doesNotMatch(page, /\.upsert\(/);
  assert.doesNotMatch(page, /church_users/);
  assert.doesNotMatch(page, /createAdminClient/);

  const landing = read("lib/auth/signed-in-landing.ts");
  // Dashboard is reachable only through the membership branch; the
  // platform-admin branch returns admin, and the fallthrough returns no access.
  assert.match(landing, /if \(input\.hasChurchMembership\) return \{ kind: "dashboard" \}/);
  assert.match(landing, /if \(input\.isPlatformAdmin\) return \{ kind: "admin" \}/);
  const dashboardReturns = landing.match(/kind: "dashboard"/g) ?? [];
  // Once in the type union, once in the membership branch. A third would mean
  // some other condition had learned to produce dashboard access.
  assert.equal(dashboardReturns.length, 2);
});

test("the dashboard layout still refuses an account without staff membership", () => {
  const layout = read("app/dashboard/layout.tsx");
  assert.match(layout, /const \[auth, featureAccess, cookieStore\]/);
  assert.match(layout, /if \(!auth\) \{\s*\n\s*redirect\("\/login"\);/);
  assert.doesNotMatch(layout, /\.insert\(/);
});

test("the misroute check re-reads membership rather than trusting the link", () => {
  const route = read(WEB_CALLBACK);
  assert.match(route, /const hasChurchMembership = Boolean\(await getChurchAuth\(\)\)/);
  assert.match(route, /landing\.kind === "no_dashboard_access"/);
  assert.doesNotMatch(route, /\.insert\(/);
  assert.doesNotMatch(route, /church_users/);
});
