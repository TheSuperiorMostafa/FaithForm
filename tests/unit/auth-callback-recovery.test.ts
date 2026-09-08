import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The behaviour under test is a middleware branch, and the middleware needs a
 * Next request plus a live Supabase client to run at all. What matters here is
 * narrower than that and worth pinning precisely: which paths the rescue fires
 * on, and which it must keep its hands off.
 */
const source = readFileSync("lib/supabase/middleware.ts", "utf8");

const rescue = source.slice(
  source.indexOf("function recoverStrippedAuthCallback"),
  source.indexOf("export async function updateSession"),
);

test("the rescue only ever fires on the origin root", () => {
  assert.match(rescue, /pathname !== "\/"/);
});

test("it acts on a stray auth code and on a reported failure", () => {
  assert.match(rescue, /params\.has\("code"\)/);
  assert.match(rescue, /params\.has\("error_description"\)/);
});

test("it forwards to the callback that knows how to exchange a code", () => {
  assert.match(rescue, /url\.pathname = "\/auth\/callback"/);
});

test("the redirect is not cachable, so a spent code is never replayed", () => {
  assert.match(rescue, /Cache-Control.*no-store/);
});

test("it runs after the tenant rewrites, not before", () => {
  const siteRewrite = source.indexOf("const siteRewrite = await rewriteChurchSite");
  const call = source.indexOf("const rescued = recoverStrippedAuthCallback");
  assert.ok(siteRewrite > 0 && call > 0, "both branches are present");
  assert.ok(
    call > siteRewrite,
    "a church's own domain must return before the rescue can claim its code",
  );
});

/**
 * The integration callbacks read a `code` of their own from Google and
 * Facebook. Hijacking one would break a church's calendar or page connection,
 * which is why the rescue is pinned to the root rather than to "has a code".
 */
test("the integration callbacks are not on the root, so they stay untouched", () => {
  for (const route of [
    "app/api/integrations/google/callback/route.ts",
    "app/api/integrations/facebook/callback/route.ts",
  ]) {
    const routeSource = readFileSync(route, "utf8");
    assert.match(
      routeSource,
      /searchParams\.get\("code"\)/,
      `${route} still reads its own code`,
    );
  }
});
