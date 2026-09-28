import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OAUTH_STATE_TTL_SECONDS,
  safeReturnTo,
  signOAuthState,
  verifyOAuthState,
} from "@/lib/integrations/oauth-state";

// Read when a state is signed, not at import.
process.env.INTEGRATION_OAUTH_STATE_SECRET ??= "test-oauth-state-secret-000000000001";

/**
 * A signed OAuth state never expired and the callback only checked that the
 * session matched it — not that the person could still connect accounts for
 * that church. A demoted or removed admin could bind their own YouTube,
 * Facebook or Google to the church. And `return_to` went unchecked into a
 * redirect, so `//evil.example` made the callback an open redirect.
 */

const base = {
  churchId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  provider: "youtube" as const,
  via: "admin" as const,
};

function forge(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", process.env.INTEGRATION_OAUTH_STATE_SECRET!)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

test("a fresh state verifies and carries how it was authorised", () => {
  const verified = verifyOAuthState(signOAuthState({ ...base, returnTo: "/dashboard/live-streaming" }));
  assert.equal(verified?.via, "admin");
  assert.equal(verified?.returnTo, "/dashboard/live-streaming");
  assert.ok(verified!.exp - Date.now() / 1000 <= OAUTH_STATE_TTL_SECONDS);
});

test("new OAuth states conceal onboarding invite links and reject tampering", () => {
  const token = "qa-invite-token-should-not-be-readable-by-providers";
  const returnTo = `/onboarding?token=${token}&step=4`;
  const state = signOAuthState({ ...base, provider: "google", via: "invite", returnTo });
  assert.match(state, /^v2\./);
  assert.equal(verifyOAuthState(state)?.returnTo, returnTo);
  assert.notEqual(state, signOAuthState({ ...base, provider: "google", via: "invite", returnTo }));
  for (const part of state.split(".")) {
    assert.equal(Buffer.from(part, "base64url").toString("utf8").includes(token), false);
  }
  const parts = state.split(".");
  parts[2] = `${parts[2] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  assert.equal(verifyOAuthState(parts.join(".")), null);
});

test("signed states already in flight can finish before their 30-minute expiry", () => {
  const state = forge({ ...base, exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(verifyOAuthState(state)?.provider, "youtube");
});

test("an expired state, or one from before states expired, is refused", () => {
  assert.equal(verifyOAuthState(forge({ ...base, exp: Math.floor(Date.now() / 1000) - 1 })), null);
  const legacy: Record<string, unknown> = { ...base };
  delete legacy.via;
  assert.equal(verifyOAuthState(forge(legacy)), null, "no exp, no via");
  assert.equal(verifyOAuthState(forge({ ...base, via: "owner", exp: Date.now() / 1000 + 60 })), null);
});

test("return_to is a same-site path or nothing", () => {
  for (const bad of ["//evil.example/x", "/\\evil.example", "https://evil.example", "evil", "/ok\\x", "/a\nb"]) {
    assert.equal(safeReturnTo(bad), undefined, bad);
  }
  assert.equal(safeReturnTo("/dashboard/settings?tab=integrations"), "/dashboard/settings?tab=integrations");
  const signed = verifyOAuthState(signOAuthState({ ...base, returnTo: "//evil.example" }));
  assert.equal(signed?.returnTo, undefined);
});

test("the callbacks re-check the way in, not just the session", () => {
  const guard = readFileSync("lib/integrations/assert-oauth-session.ts", "utf8");
  assert.match(guard, /payload\.via === "invite"/);
  assert.match(guard, /auth\?\.isAdmin && auth\.churchId === churchId/);
  for (const provider of ["google", "facebook"]) {
    const callback = readFileSync(`app/api/integrations/${provider}/callback/route.ts`, "utf8");
    assert.match(callback, /assertOAuthSessionUser\(payload, returnTo\)/);
  }
  const redirect = readFileSync("lib/integrations/app-redirect.ts", "utf8");
  assert.match(redirect, /const safe = safeReturnTo\(returnTo\)/);
});
