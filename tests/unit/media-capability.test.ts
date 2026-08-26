import assert from "node:assert/strict";
import test from "node:test";

process.env.STREAM_PLAYBACK_SECRET =
  "stream-playback-secret-that-is-at-least-32-bytes";

import {
  MAX_CAPABILITY_LENGTH,
  MEDIA_CAPABILITY_TTL_SECONDS,
  capabilityFromRequest,
  issueMediaCapability,
  mediaPlaybackConfigured,
  verifyMediaCapability,
} from "@/lib/media/v1/playback-capability";
import { signPlaybackToken, verifyPlaybackToken } from "@/lib/stream/playback";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const OTHER_MEDIA = "44444444-4444-4444-8444-444444444444";

function issue(overrides: Partial<Parameters<typeof issueMediaCapability>[0]> = {}) {
  return issueMediaCapability({
    accountId: ACCOUNT,
    churchSlug: "grace",
    kind: "recording",
    mediaId: MEDIA,
    authorizationVersion: 1,
    ...overrides,
  })!;
}

// ---------------------------------------------------------------------------
// Shape and contents
// ---------------------------------------------------------------------------

test("a capability round-trips and is bound to account, church, kind and item", () => {
  const { token } = issue();
  const verified = verifyMediaCapability(token);

  assert.ok(verified.ok);
  assert.equal(verified.ok && verified.capability.a, ACCOUNT);
  assert.equal(verified.ok && verified.capability.c, "grace");
  assert.equal(verified.ok && verified.capability.k, "recording");
  assert.equal(verified.ok && verified.capability.m, MEDIA);
  assert.equal(verified.ok && verified.capability.av, 1);
});

test("a capability carries no provider path, key or People data", () => {
  const { token } = issue();
  const body = Buffer.from(token.split(".")[1], "base64url").toString("utf8");

  assert.ok(!body.includes(process.env.STREAM_PLAYBACK_SECRET!));
  for (const forbidden of [
    "relay/", "storage", "signedUrl", "supabase", "http", "member",
    "email", "phone", "name", "bucket",
  ]) {
    assert.ok(!body.toLowerCase().includes(forbidden.toLowerCase()), `leaks ${forbidden}`);
  }
});

test("a capability stays inside the length guard", () => {
  assert.ok(issue().token.length <= MAX_CAPABILITY_LENGTH);
});

// ---------------------------------------------------------------------------
// Scoping — the whole reason this is not the website capability
// ---------------------------------------------------------------------------

test("a capability minted for one account is refused for another", () => {
  const { token } = issue();

  assert.equal(verifyMediaCapability(token, { accountId: ACCOUNT }).ok, true);
  const crossed = verifyMediaCapability(token, { accountId: OTHER_ACCOUNT });
  assert.equal(crossed.ok, false);
  assert.equal(crossed.ok === false && crossed.reason, "mismatch");
});

test("a capability minted for one church is refused for another", () => {
  const { token } = issue();
  assert.equal(verifyMediaCapability(token, { churchSlug: "other" }).ok, false);
});

test("a capability minted for one item is refused for another", () => {
  const { token } = issue();
  assert.equal(verifyMediaCapability(token, { mediaId: OTHER_MEDIA }).ok, false);
});

test("a recording capability cannot fetch a live stream", () => {
  const { token } = issue({ kind: "recording" });
  // The live delivery route asks for `kind: "live"`. A capability for the
  // archive must not open the relay.
  assert.equal(verifyMediaCapability(token, { kind: "live" }).ok, false);
  assert.equal(verifyMediaCapability(token, { kind: "recording" }).ok, true);
});

test("an authorization-version change invalidates a capability in flight", () => {
  const { token } = issue({ authorizationVersion: 3 });

  assert.equal(verifyMediaCapability(token, { authorizationVersion: 3 }).ok, true);
  // Any event that bumps the account's authorization version — a relationship
  // revoked, a sign-out, a block — makes every capability already issued stop
  // verifying, without needing to find and revoke each one.
  assert.equal(verifyMediaCapability(token, { authorizationVersion: 4 }).ok, false);
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

test("a capability expires, and is short-lived", () => {
  const now = 1_800_000_000;
  const { token } = issue({ nowSeconds: now });

  assert.equal(verifyMediaCapability(token, { nowSeconds: now + 60 }).ok, true);
  const expired = verifyMediaCapability(token, {
    nowSeconds: now + MEDIA_CAPABILITY_TTL_SECONDS + 1,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.ok === false && expired.reason, "expired");
});

test("a requested lifetime cannot exceed the ceiling", () => {
  const now = 1_800_000_000;
  // A caller asking for a day gets five minutes. The ceiling is the policy;
  // the parameter is only allowed to make it shorter.
  const { token } = issue({ nowSeconds: now, ttlSeconds: 86_400 });
  assert.equal(
    verifyMediaCapability(token, { nowSeconds: now + MEDIA_CAPABILITY_TTL_SECONDS + 1 }).ok,
    false,
  );
});

test("the expiry is inside the signed body, so a holder cannot extend it", () => {
  const { token } = issue();
  const [format, body, signature] = token.split(".");

  const forged = Buffer.from(
    JSON.stringify({
      v: 1, t: "playback", a: ACCOUNT, c: "grace", k: "recording",
      m: MEDIA, av: 1, e: 9_999_999_999,
    }),
    "utf8",
  ).toString("base64url");

  assert.equal(verifyMediaCapability(`${format}.${forged}.${signature}`).ok, false);
});

// ---------------------------------------------------------------------------
// Tampering and malformed input
// ---------------------------------------------------------------------------

test("a tampered body fails before its contents are trusted", () => {
  const { token } = issue();
  const [format, body, signature] = token.split(".");

  const flipped = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  const tampered = verifyMediaCapability(`${format}.${body}.${flipped}`);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.ok === false && tampered.reason, "bad_signature");
});

test("malformed input is refused rather than parsed", () => {
  for (const bad of [
    "", "nodot", "a.b", "a.b.c.d", "FFM2.a.b",
    "x".repeat(MAX_CAPABILITY_LENGTH + 1), null, undefined,
  ]) {
    assert.equal(
      verifyMediaCapability(bad as string).ok,
      false,
      String(bad).slice(0, 12),
    );
  }
});

// ---------------------------------------------------------------------------
// Domain separation from the website capability
// ---------------------------------------------------------------------------

test("a website playback token is not a Faithful capability, and vice versa", () => {
  const websiteToken = signPlaybackToken(
    { churchId: "church-id", eventId: "event-id", audience: "public" },
    { secret: process.env.STREAM_PLAYBACK_SECRET },
  );
  const { token: faithful } = issue({ kind: "live" });

  // **The property that makes sharing one secret safe.** Both are signed with
  // `STREAM_PLAYBACK_SECRET`, but through different derived sub-keys — so a
  // website token, which is not account-scoped, cannot be replayed against a
  // Faithful route, and a Faithful capability cannot open the website's.
  assert.equal(verifyMediaCapability(websiteToken).ok, false);
  assert.equal(verifyPlaybackToken(faithful, { secret: process.env.STREAM_PLAYBACK_SECRET }), null);
});

// ---------------------------------------------------------------------------
// Where a capability may travel
// ---------------------------------------------------------------------------

test("a capability is read from a bearer header and from nowhere else", () => {
  const { token } = issue();

  const withHeader = new Request("https://example.test/x", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(capabilityFromRequest(withHeader), token);

  // **No query-string fallback exists.** Adding one would put the capability
  // back into URLs, browser histories, proxy logs and referrers — which is the
  // thing both native players were wired around.
  const inUrl = new Request(`https://example.test/x?cap=${encodeURIComponent(token)}`);
  assert.equal(capabilityFromRequest(inUrl), null);

  for (const header of ["", "Basic abc", "Bearer", "bearer "]) {
    assert.equal(
      capabilityFromRequest(new Request("https://example.test/x", { headers: { authorization: header } })),
      null,
      header,
    );
  }
});

test("lowercase and mixed-case bearer schemes are accepted", () => {
  const { token } = issue();
  for (const scheme of ["Bearer", "bearer", "BEARER"]) {
    assert.equal(
      capabilityFromRequest(
        new Request("https://example.test/x", {
          headers: { authorization: `${scheme} ${token}` },
        }),
      ),
      token,
      scheme,
    );
  }
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test("a weak, placeholder or absent secret refuses to sign at all", () => {
  const original = process.env.STREAM_PLAYBACK_SECRET;

  for (const bad of ["too-short", "replace-me-with-a-real-secret-value-here"]) {
    process.env.STREAM_PLAYBACK_SECRET = bad;
    assert.equal(issueMediaCapability({
      accountId: ACCOUNT, churchSlug: "grace", kind: "live",
      mediaId: MEDIA, authorizationVersion: 1,
    }), null, bad);
    assert.equal(mediaPlaybackConfigured(), false, bad);
  }

  delete process.env.STREAM_PLAYBACK_SECRET;
  assert.equal(mediaPlaybackConfigured(), false);
  // And verification refuses rather than accepting anything.
  const unconfigured = verifyMediaCapability("FFM1.a.b");
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.ok === false && unconfigured.reason, "unconfigured");

  process.env.STREAM_PLAYBACK_SECRET = original;
  assert.equal(mediaPlaybackConfigured(), true);
});
