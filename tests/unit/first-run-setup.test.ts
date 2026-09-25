import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALREADY_REGISTERED_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
  isAlreadyRegistered,
  signInErrorMessage,
  signInLinkErrorMessage,
  signUpErrorMessage,
} from "../../app/login/auth-messages";
import { planGettingStarted } from "../../components/setup/getting-started-items";

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Auth refusals in plain words
// ---------------------------------------------------------------------------

test("a wrong password says so plainly and offers the sign-in link", () => {
  assert.equal(signInErrorMessage({ message: "Invalid login credentials" }), WRONG_PASSWORD_MESSAGE);
  assert.equal(signInErrorMessage({ code: "invalid_credentials", message: "x" }), WRONG_PASSWORD_MESSAGE);
  assert.match(WRONG_PASSWORD_MESSAGE, /sign-in link/);
});

test("unknown provider text never reaches the page", () => {
  const raw = "AuthApiError: unexpected_failure at /token";
  for (const message of [
    signInErrorMessage({ message: raw }),
    signInLinkErrorMessage({ message: raw }),
    signUpErrorMessage({ message: raw }, 8),
  ]) {
    assert.ok(!message.includes("AuthApiError"), message);
    assert.match(message, /^We couldn't/);
  }
});

test("an unconfirmed email and a weak password get their own next step", () => {
  assert.match(signInErrorMessage({ message: "Email not confirmed" }), /confirm/);
  assert.match(signUpErrorMessage({ code: "weak_password", message: "x" }, 8), /at least 8 characters/);
});

test("an existing account on sign-up is recognised and points to sign in", () => {
  assert.equal(isAlreadyRegistered({ message: "User already registered" }), true);
  assert.equal(isAlreadyRegistered({ code: "user_already_exists", message: "" }), true);
  assert.equal(isAlreadyRegistered({ message: "Password is too weak" }), false);
  assert.match(ALREADY_REGISTERED_MESSAGE, /Sign in instead/);
});

test("sign-in and setup never pass raw auth errors to the page", () => {
  const login = read("app/login/actions.ts");
  assert.doesNotMatch(login, /\?\? error\.message/);
  const setup = read("app/setup/actions.ts");
  assert.doesNotMatch(setup, /error: signUpError\.message/);
  const onboarding = read("app/onboarding/actions.ts");
  assert.doesNotMatch(onboarding, /error: signUpError\.message/);
  assert.doesNotMatch(onboarding, /error: (error|uploadError|linkError)\.message/);
});

// ---------------------------------------------------------------------------
// Sign-in page
// ---------------------------------------------------------------------------

test("the sign-in page is plain, offers both ways in, and links to setup", () => {
  const form = read("app/login/login-form.tsx");
  assert.match(form, /Sign in to FaithForm/);
  assert.match(form, /Email me a sign-in link/);
  assert.doesNotMatch(form, /[Mm]agic link"/, "no 'magic link' wording on screen");
  assert.match(form, /Forgot password\?/);
  // Password stays the default: teammates arrive with a temporary password.
  assert.match(form, /useState<Mode>\("password"\)/);

  const shell = read("app/login/login-shell.tsx");
  assert.match(shell, /New to FaithForm\?/);
  assert.match(shell, /href="\/setup"/);
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test("setup infers the time zone and the server still validates it", () => {
  const flow = read("components/setup/setup-flow.tsx");
  assert.match(flow, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(flow, /name="timezone"/);
  const actions = read("app/setup/actions.ts");
  assert.match(actions, /if \(!isUsableTimezone\(timezone\)\)/);
});

test("setup points to the real place for logo, address and service times", () => {
  const copy = read("components/setup/setup-copy.ts");
  assert.match(copy, /"\/dashboard\/settings\?tab=church"/);
  const flow = read("components/setup/setup-flow.tsx");
  assert.match(flow, /Settings → Church info/);
  assert.match(flow, /Go to FaithForm/);
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

test("onboarding uses readable progress labels and a primary finish button", () => {
  const progress = read("components/onboarding/onboarding-progress.tsx");
  assert.doesNotMatch(progress, /text-\[1[01]px\]|text-xs/);
  const done = read("components/onboarding/steps/step-done.tsx");
  assert.match(done, /Go to FaithForm/);
  assert.match(done, /buttonVariants\(\{ size: "lg" \}\)/);
  for (const step of ["step-google", "step-facebook"]) {
    assert.match(read(`components/onboarding/steps/${step}.tsx`), /<OptionalNote \/>/, step);
  }
  assert.match(read("components/onboarding/steps/optional-note.tsx"), /Settings → Connected accounts/);
});

// ---------------------------------------------------------------------------
// Home's "Finish setting up" checklist
// ---------------------------------------------------------------------------

const nothingDone = {
  hasServiceTimes: false,
  hasLogo: false,
  teamSize: 1,
  hasCalendar: false,
  givingReady: false,
};

test("a brand-new church sees every item, giving only when allowed", () => {
  const withGiving = planGettingStarted(nothingDone, ["giving"]);
  assert.deepEqual(
    withGiving.todo.map((item) => item.key),
    ["serviceTimes", "logo", "team", "calendar", "giving"],
  );
  assert.equal(withGiving.doneCount, 0);
  assert.equal(withGiving.totalCount, 5);

  const withoutGiving = planGettingStarted(nothingDone, []);
  assert.ok(!withoutGiving.todo.some((item) => item.key === "giving"));
  assert.equal(withoutGiving.totalCount, 4);
});

test("done items tick themselves off and the card empties when all are done", () => {
  const partly = planGettingStarted({ ...nothingDone, hasLogo: true, teamSize: 3 }, ["giving"]);
  assert.deepEqual(
    partly.todo.map((item) => item.key),
    ["serviceTimes", "calendar", "giving"],
  );
  assert.equal(partly.doneCount, 2);

  const all = planGettingStarted(
    { hasServiceTimes: true, hasLogo: true, teamSize: 2, hasCalendar: true, givingReady: true },
    ["giving"],
  );
  assert.equal(all.todo.length, 0);
});

test("a check that failed hides its item instead of guessing", () => {
  const plan = planGettingStarted(
    { hasServiceTimes: null, hasLogo: false, teamSize: null, hasCalendar: null, givingReady: null },
    ["giving"],
  );
  assert.deepEqual(plan.todo.map((item) => item.key), ["logo"]);
  assert.equal(plan.totalCount, 1);
});

test("each item goes straight to where it is done", () => {
  const hrefs = Object.fromEntries(
    planGettingStarted(nothingDone, ["giving"]).todo.map((item) => [item.key, item.href]),
  );
  assert.deepEqual(hrefs, {
    serviceTimes: "/dashboard/settings?tab=church",
    logo: "/dashboard/settings?tab=church",
    team: "/dashboard/settings?tab=team",
    calendar: "/dashboard/settings?tab=accounts",
    giving: "/dashboard/giving",
  });
});

test("the checklist is admin-only and scoped to the church", () => {
  const card = read("components/setup/getting-started-card.tsx");
  assert.match(card, /if \(!isAdmin \|\| !churchId\) return null;/);
  assert.match(card, /\.eq\("church_id", churchId\)/);
  assert.match(card, /export function GettingStartedSkeleton/);
});
