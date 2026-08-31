import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const setupActions = read("app/setup/actions.ts");
const setupPage = read("app/setup/page.tsx");
const loginForm = read("app/login/login-form.tsx");
const loginActions = read("app/login/actions.ts");
const dashboardPage = read("app/dashboard/page.tsx");
const setPasswordPage = read("app/set-password/page.tsx");
const rlsPolicies = read("supabase/migrations/0002_rls_policies.sql");

// ---------------------------------------------------------------------------
// Self-serve church setup respects the existing tenant boundary
// ---------------------------------------------------------------------------

test("church creation stays a server decision — no INSERT policy for browsers", () => {
  // The setup flow adds no migration and must keep relying on RLS as-is:
  // `churches` has select and update policies only, so a browser insert is
  // denied and creation happens through the service role alone.
  assert.match(rlsPolicies, /create policy "churches_select"/);
  assert.doesNotMatch(
    rlsPolicies,
    /create policy "churches_insert"/,
    "an INSERT policy on churches would open self-serve creation to raw clients",
  );
});

test("the setup action authenticates before any write", () => {
  const body = setupActions.slice(
    setupActions.indexOf("export async function createChurchForCurrentUser"),
  );
  const getUser = body.indexOf("auth.getUser()");
  const insert = body.indexOf('from("churches")');
  assert.ok(getUser > -1, "createChurchForCurrentUser must resolve the session");
  assert.ok(insert > -1, "createChurchForCurrentUser must insert the church");
  assert.ok(getUser < insert, "the session must be resolved before the insert");
});

test("one person, one church — the invariant is checked before creating", () => {
  // The same rule team management enforces: an account that already belongs
  // to a church cannot mint a second one.
  assert.match(setupActions, /from\("church_users"\)[\s\S]{0,200}\.eq\("user_id", user\.id\)/);
  assert.match(setupActions, /already belongs to a church/);
});

test("the creator becomes an admin through the existing role model", () => {
  // Exactly the role `completeOnboarding` writes — no new role is invented.
  assert.match(setupActions, /role: "admin"/);
  assert.doesNotMatch(setupActions, /role: "owner"/, "no 'owner' role exists in this schema");
});

test("a church without its admin is rolled back, not left orphaned", () => {
  const body = setupActions.slice(setupActions.indexOf("linkError"));
  assert.match(body, /from\("churches"\)\.delete\(\)\.eq\("id", church\.id\)/);
});

test("both public setup actions are rate limited", () => {
  assert.match(setupActions, /enforceSetupRateLimit\("account"/);
  assert.match(setupActions, /enforceSetupRateLimit\("church"/);
  assert.match(loginActions, /enforceLoginRateLimit\("password-reset"\)/);
});

test("a signed-in member of a church is redirected out of setup", () => {
  assert.match(setupPage, /redirect\("\/dashboard"\)/);
});

// ---------------------------------------------------------------------------
// No dead ends on the way in
// ---------------------------------------------------------------------------

test("the sign-in page does not advertise church setup", () => {
  // Churches are onboarded by us, not by strangers finding a self-serve door
  // on the sign-in screen. /setup still exists and is still reachable — the
  // no-church dashboard panel below links to it — but it is no longer offered
  // to anyone who lands on /login.
  assert.doesNotMatch(loginForm, /href="\/setup"/);
  assert.doesNotMatch(loginForm, /Set up your church/);
});

test("the sign-in page offers a way out of a forgotten password", () => {
  assert.match(loginForm, /Forgot password\?/);
  assert.match(loginActions, /resetPasswordForEmail/);
});

test("a signed-in account with no church is offered setup, not a dead end", () => {
  assert.match(dashboardPage, /href="\/setup"/);
  assert.doesNotMatch(
    dashboardPage,
    /Contact support to connect\s+your church before using the dashboard\./,
    "the no-church panel must offer an action, not only instructions",
  );
});

test("password recovery reuses the one screen that sets passwords", () => {
  // The recovery link arrives already signed in via /auth/callback; the page
  // admits it without the temp-password flag but never without a session.
  assert.match(setPasswordPage, /reason === "recovery"/);
  assert.match(setPasswordPage, /if \(!user\) redirect\("\/login"\)/);
});

test("password reset does not reveal whether an address has an account", () => {
  const body = loginActions.slice(loginActions.indexOf("export async function sendPasswordReset"));
  // A "no such user" reply from the provider is swallowed into the same
  // success the happy path returns, so the form cannot enumerate addresses.
  assert.match(body, /if \(error && !\/user\|email\/i\.test\(error\.message\)\)/);
  assert.match(body, /return \{ ok: true \};/);
});
