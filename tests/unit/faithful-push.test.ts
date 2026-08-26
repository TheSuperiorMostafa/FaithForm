import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyApnsResponse,
  classifyFcmResponse,
  buildApnsPayload,
  buildFcmPayload,
  safeReason,
  safeErrorCode,
  ApnsAdapter,
  FcmAdapter,
  FakePushAdapter,
} from "@/lib/faithful/push/adapters";
import { dedupeKeyFor } from "@/lib/faithful/push/outbox";

// ---------------------------------------------------------------------------
// APNs classification
// ---------------------------------------------------------------------------

test("APNs success is sent", () => {
  assert.equal(classifyApnsResponse(200).outcome, "sent");
});

test("APNs 410 and BadDeviceToken mean stop sending to this device", () => {
  for (const [status, reason] of [[410, undefined], [400, "BadDeviceToken"], [400, "Unregistered"]] as const) {
    const result = classifyApnsResponse(status, reason);
    assert.equal(result.outcome, "permanent", `${status} ${reason}`);
    assert.equal(result.invalidToken, true, `${status} ${reason}`);
    assert.equal(result.errorCategory, "invalid_token");
  }
});

test("APNs throttling and outages retry; credential failures do not", () => {
  for (const status of [429, 500, 503]) {
    assert.equal(classifyApnsResponse(status).outcome, "retryable", String(status));
  }
  // Retrying a rejected credential only makes it worse.
  const auth = classifyApnsResponse(403);
  assert.equal(auth.outcome, "permanent");
  assert.equal(auth.errorCategory, "auth_rejected");
  assert.notEqual(auth.invalidToken, true);
});

test("APNs payload problems are permanent, not retried forever", () => {
  assert.equal(classifyApnsResponse(413).outcome, "permanent");
  assert.equal(classifyApnsResponse(400).outcome, "permanent");
});

test("an unrecognised APNs status is retried rather than dropped", () => {
  const result = classifyApnsResponse(418);
  assert.equal(result.outcome, "retryable");
  assert.equal(result.errorCategory, "unclassified");
});

// ---------------------------------------------------------------------------
// FCM classification
// ---------------------------------------------------------------------------

test("FCM UNREGISTERED and 404 invalidate the token", () => {
  for (const [status, code] of [[404, undefined], [400, "UNREGISTERED"]] as const) {
    const result = classifyFcmResponse(status, code);
    assert.equal(result.outcome, "permanent");
    assert.equal(result.invalidToken, true);
  }
});

test("FCM quota and unavailability retry", () => {
  assert.equal(classifyFcmResponse(429).outcome, "retryable");
  assert.equal(classifyFcmResponse(503).outcome, "retryable");
  assert.equal(classifyFcmResponse(500, "UNAVAILABLE").outcome, "retryable");
});

test("FCM auth failures are permanent and never invalidate a token", () => {
  for (const [status, code] of [[401, undefined], [403, undefined], [403, "SENDER_ID_MISMATCH"]] as const) {
    const result = classifyFcmResponse(status, code);
    assert.equal(result.outcome, "permanent", `${status}`);
    assert.equal(result.errorCategory, "auth_rejected");
    // A misconfigured sender must not wipe every device's token.
    assert.notEqual(result.invalidToken, true, `${status}`);
  }
});

// ---------------------------------------------------------------------------
// Payloads carry a hint, never the content
// ---------------------------------------------------------------------------

test("an APNs payload carries a deep link and no content beyond a preview", () => {
  const payload = buildApnsPayload({
    title: "Sunday service",
    body: "Doors at nine",
    deepLink: "faithful://church/grace/announcements",
    collapseKey: "announcement-1",
    correlationId: "c-1",
  }) as Record<string, never>;

  const serialized = JSON.stringify(payload);
  assert.match(serialized, /faithful:\/\/church\/grace\/announcements/);
  // No identifiers that would let a payload be treated as authoritative.
  for (const forbidden of ["announcementId", "churchId", "accountId", "token"]) {
    assert.ok(!serialized.includes(forbidden), `payload contains ${forbidden}`);
  }
});

test("an FCM payload targets exactly one token and collapses per subject", () => {
  const payload = buildFcmPayload("token-abc", {
    title: "T",
    body: null,
    deepLink: "faithful://church/grace/announcements",
    collapseKey: "announcement-9",
    correlationId: "c-2",
  }) as { message: Record<string, unknown> };

  assert.equal(payload.message.token, "token-abc");
  assert.equal(
    (payload.message.android as Record<string, unknown>).collapse_key,
    "announcement-9",
  );
});

// ---------------------------------------------------------------------------
// Provider bodies are never retained wholesale
// ---------------------------------------------------------------------------

test("only the documented keyword is extracted from a provider body", () => {
  assert.equal(safeReason('{"reason":"BadDeviceToken"}'), "BadDeviceToken");
  assert.equal(safeErrorCode('{"error":{"status":"UNREGISTERED"}}'), "UNREGISTERED");
  // A body with no recognised field yields nothing rather than being kept.
  assert.equal(safeReason("<html>token=abc123</html>"), undefined);
  assert.equal(safeErrorCode("<html>token=abc123</html>"), undefined);
});

// ---------------------------------------------------------------------------
// Configuration fails closed
// ---------------------------------------------------------------------------

test("an unconfigured adapter skips rather than falling back to something weaker", async () => {
  const original = { ...process.env };
  for (const key of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_TOPIC", "FCM_PROJECT_ID", "FCM_ACCESS_TOKEN"]) {
    delete process.env[key];
  }

  const apns = new ApnsAdapter();
  const fcm = new FcmAdapter();
  assert.equal(apns.isConfigured(), false);
  assert.equal(fcm.isConfigured(), false);

  const apnsResult = await apns.send("token", {
    title: "t", body: null, deepLink: "faithful://home", collapseKey: "c", correlationId: "x",
  });
  assert.equal(apnsResult.outcome, "skipped");
  assert.equal(apnsResult.errorCategory, "not_configured");

  const fcmResult = await fcm.send("token", {
    title: "t", body: null, deepLink: "faithful://home", collapseKey: "c", correlationId: "x",
  });
  assert.equal(fcmResult.outcome, "skipped");

  process.env = original;
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

test("the same announcement at the same version yields one logical notification", () => {
  const a = dedupeKeyFor("11111111-1111-4111-8111-111111111111", 3);
  assert.equal(a, dedupeKeyFor("11111111-1111-4111-8111-111111111111", 3));
  // A genuine re-publish after an edit is a new notification.
  assert.notEqual(a, dedupeKeyFor("11111111-1111-4111-8111-111111111111", 4));
  // Two announcements never collide.
  assert.notEqual(a, dedupeKeyFor("22222222-2222-4222-8222-222222222222", 3));
  assert.match(a, /^[0-9a-f]{40}$/);
});

test("the fake adapter records what it was asked, for deterministic tests", async () => {
  const fake = new FakePushAdapter("apns", [
    { outcome: "sent" },
    { outcome: "permanent", invalidToken: true, errorCategory: "invalid_token" },
  ]);

  const first = await fake.send("t1", {
    title: "a", body: null, deepLink: "faithful://home", collapseKey: "c", correlationId: "x",
  });
  const second = await fake.send("t2", {
    title: "a", body: null, deepLink: "faithful://home", collapseKey: "c", correlationId: "x",
  });

  assert.equal(first.outcome, "sent");
  assert.equal(second.invalidToken, true);
  assert.equal(fake.sent.length, 2);
  assert.equal(fake.sent[1].token, "t2");
});
