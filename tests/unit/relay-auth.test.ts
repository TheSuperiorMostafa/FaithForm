import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticateRelayRequest,
  signRelayPayload,
  verifyRelaySignature,
  RELAY_NONCE_HEADER,
  RELAY_SIGNATURE_HEADER,
  RELAY_TIMESTAMP_HEADER,
} from "@/lib/stream/relay-auth";

const SECRET = "relay-secret-for-tests-0123456789";
const NOW = 1_790_000_000;

function signedRequest(body: string, options: { nonce?: string; timestamp?: number; secret?: string } = {}) {
  const nonce = options.nonce ?? `nonce_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const timestamp = options.timestamp ?? NOW;
  return new Request("https://faithform.test/api/stream/relay/recording/prepare", {
    method: "POST",
    body,
    headers: {
      [RELAY_SIGNATURE_HEADER]: signRelayPayload({ secret: options.secret ?? SECRET, timestamp, nonce, body }),
      [RELAY_TIMESTAMP_HEADER]: String(timestamp),
      [RELAY_NONCE_HEADER]: nonce,
      "content-type": "application/json",
    },
  });
}

function ledger() {
  const seen = new Set<string>();
  return async ({ nonce }: { nonce: string }) => {
    if (seen.has(nonce)) return false;
    seen.add(nonce);
    return true;
  };
}

test.beforeEach(() => {
  process.env.STREAM_RELAY_WEBHOOK_SECRET = SECRET;
});

test("a correctly signed, fresh request is accepted and parsed", async () => {
  const result = await authenticateRelayRequest(signedRequest(`{"a":1}`), {
    route: "prepare",
    allowLegacySecret: false,
    ledger: ledger(),
    nowSeconds: NOW,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.json, { a: 1 });
});

test("a tampered body, a wrong key, or a stale timestamp is refused", async () => {
  const body = `{"a":1}`;
  const sig = signRelayPayload({ secret: SECRET, timestamp: NOW, nonce: "nonce_abcdefghijklmnop", body });
  assert.equal(
    verifyRelaySignature({ secret: SECRET, signature: sig, timestamp: String(NOW), nonce: "nonce_abcdefghijklmnop", body: `{"a":2}`, nowSeconds: NOW }).ok,
    false,
  );
  const wrongKey = await authenticateRelayRequest(signedRequest(body, { secret: "some-other-secret-entirely" }), {
    route: "prepare",
    allowLegacySecret: false,
    ledger: ledger(),
    nowSeconds: NOW,
  });
  assert.deepEqual(wrongKey, { ok: false, status: 401, error: "Unauthorized" });
  const stale = await authenticateRelayRequest(signedRequest(body, { timestamp: NOW - 301 }), {
    route: "prepare",
    allowLegacySecret: false,
    ledger: ledger(),
    nowSeconds: NOW,
  });
  assert.equal(stale.ok, false);
});

test("a replayed request is refused even though its signature is genuine", async () => {
  const shared = ledger();
  const body = `{"take":"x"}`;
  const first = await authenticateRelayRequest(signedRequest(body, { nonce: "nonce_replay_0123456789" }), {
    route: "commit",
    allowLegacySecret: false,
    ledger: shared,
    nowSeconds: NOW,
  });
  const replay = await authenticateRelayRequest(signedRequest(body, { nonce: "nonce_replay_0123456789" }), {
    route: "commit",
    allowLegacySecret: false,
    ledger: shared,
    nowSeconds: NOW,
  });
  assert.equal(first.ok, true);
  assert.deepEqual(replay, { ok: false, status: 409, error: "Replayed request." });
});

test("an unsigned request never reaches the parser, and the legacy header only works where allowed", async () => {
  const unsigned = new Request("https://faithform.test/x", {
    method: "POST",
    body: "not json at all",
    headers: { "x-stream-relay-secret": SECRET },
  });
  const strict = await authenticateRelayRequest(unsigned.clone(), {
    route: "prepare",
    allowLegacySecret: false,
    ledger: ledger(),
  });
  assert.deepEqual(strict, { ok: false, status: 401, error: "Unauthorized" });

  const legacy = await authenticateRelayRequest(
    new Request("https://faithform.test/x", { method: "POST", body: "{}", headers: { "x-stream-relay-secret": SECRET } }),
    { route: "lifecycle", allowLegacySecret: true, ledger: ledger() },
  );
  assert.equal(legacy.ok, true);

  const wrongLegacy = await authenticateRelayRequest(
    new Request("https://faithform.test/x", { method: "POST", body: "{}", headers: { "x-stream-relay-secret": "nope" } }),
    { route: "lifecycle", allowLegacySecret: true, ledger: ledger() },
  );
  assert.equal(wrongLegacy.ok, false);
});

test("an oversized body is refused before it is read into the parser", async () => {
  const big = JSON.stringify({ pad: "x".repeat(70 * 1024) });
  const result = await authenticateRelayRequest(signedRequest(big), {
    route: "prepare",
    allowLegacySecret: false,
    ledger: ledger(),
    nowSeconds: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.status, 413);
});

test("with no secret configured, nothing is accepted", async () => {
  delete process.env.STREAM_RELAY_WEBHOOK_SECRET;
  const result = await authenticateRelayRequest(signedRequest("{}"), {
    route: "prepare",
    allowLegacySecret: true,
    ledger: ledger(),
    nowSeconds: NOW,
  });
  assert.equal(result.ok, false);
});
