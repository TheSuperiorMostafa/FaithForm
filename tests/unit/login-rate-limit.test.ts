import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rateLimit = readFileSync("lib/security/rate-limit.ts", "utf8");
const login = readFileSync("app/login/actions.ts", "utf8");

/**
 * The limiter refuses when it cannot answer, which is the right call on a
 * sign-in endpoint. What was wrong is that the refusal was indistinguishable
 * from a real one, so a broken limiter presented as a permanent lockout on
 * every browser with no attempt count that could explain it.
 */
test("every refusal says whether it was a real limit or a broken limiter", () => {
  const refusals = rateLimit.match(/ok:\s*false/g) ?? [];
  const reasons = rateLimit.match(/reason:\s*"(limited|unavailable)"/g) ?? [];
  assert.equal(
    refusals.length,
    reasons.length,
    "every `ok: false` must carry a reason",
  );
});

test("the four ways the limiter can fail are all 'unavailable'", () => {
  for (const cause of [
    "invalid options",
    "no service-role client",
    "RATE_LIMIT_KEY_SECRET is missing or rejected",
    "did not answer",
  ]) {
    const at = rateLimit.indexOf(cause);
    assert.ok(at > 0, `no branch logs about ${cause}`);
    const after = rateLimit.slice(at, at + 240);
    assert.match(after, /reason: "unavailable"/, `${cause} must be unavailable`);
  }
});

test("a real overage is reported as 'limited' with a wait", () => {
  const at = rateLimit.indexOf('reason: "limited"');
  assert.ok(at > 0);
  assert.match(rateLimit.slice(at, at + 160), /retryAfterSeconds/);
});

/** Telling someone they tried too often when they did not sends them hunting. */
test("a broken limiter does not accuse the person of trying too often", () => {
  const at = login.indexOf('rate.reason === "unavailable"');
  assert.ok(at > 0, "the login form must branch on the reason");
  // Stop at the end of this branch, or the next one's wording bleeds in.
  const branch = login.slice(at, login.indexOf("\n  }", at));
  assert.ok(
    !/too many/i.test(branch),
    "the unavailable branch must not say 'too many attempts'",
  );
  assert.match(branch, /not with your account/i);
  assert.match(branch, /console\.error/, "and it must be logged as our fault");
});

test("a real overage still says how long to wait", () => {
  assert.match(login, /Too many attempts\. Please try again in \$\{minutes\}/);
});

/**
 * Supabase's own throttling arrives as prose that differs by endpoint, and it
 * was being rendered verbatim on the sign-in screen.
 */
test("provider throttling is translated on both sign-in paths", () => {
  const calls = login.match(/describeAuthError\(error\.message\)/g) ?? [];
  assert.ok(calls.length >= 2, "magic link and password must both translate");
  assert.match(login, /you can only request this after/i);
});

test("the translator leaves an ordinary wrong password alone", () => {
  const at = login.indexOf("function describeAuthError");
  const body = login.slice(at, login.indexOf("\n}", at));
  assert.match(body, /return null/, "a non-throttle message passes through");
  assert.ok(
    !/invalid login credentials/i.test(body),
    "wrong-password wording must not be rewritten as throttling",
  );
});
