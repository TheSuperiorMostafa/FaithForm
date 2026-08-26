import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("production security configuration is mandatory and middleware fails closed", () => {
  const env = read("lib/env/production.ts");
  const middleware = read("lib/supabase/middleware.ts");
  for (const name of [
    "DONOR_PORTAL_SESSION_SECRET",
    "RATE_LIMIT_KEY_SECRET",
    "STREAM_RELAY_WEBHOOK_SECRET",
    "STREAM_RELAY_PLAYBACK_SECRET",
    "STREAM_INGEST_SIGNING_SECRET",
    "STREAM_PLAYBACK_SECRET",
    "STRIPE_WEBHOOK_SECRET",
    "CRON_SECRET",
  ]) {
    assert.match(env, new RegExp(name));
  }
  assert.match(env, /uniqueSecretValues\.size !== secrets\.size/);
  assert.match(env, /ProductionEnvError/);
  assert.match(middleware, /status:\s*503/);
  assert.match(middleware, /failedChecks\.join/);
  assert.doesNotMatch(middleware, /configurationError\.message/);
  assert.doesNotMatch(middleware, /error\.message/);
});

test("public mutation routes have bounded payloads and atomic abuse controls", () => {
  const chat = read("app/live/[slug]/actions.ts");
  const view = read("app/api/stream/view/route.ts");
  const portal = read("app/api/give/portal/send-link/route.ts");
  const encoder = read("app/api/stream/encoder/register/route.ts");
  for (const source of [chat, view, portal, encoder]) {
    assert.match(source, /assertRateLimit/);
  }
  assert.match(chat, /body:\s*z\.string\(\).*max\(500\)/);
  assert.match(view, /content-length/);
  assert.match(encoder, /content-length/);
});

test("machine credentials stay in headers and relay auth uses a local bridge", () => {
  const protectedRoutes = [
    "app/api/stream/publish-auth/route.ts",
    "app/api/stream/relay-config/route.ts",
    "app/api/stream/lifecycle/route.ts",
    "app/api/stream/recording-upload-url/route.ts",
    "app/api/stream/recording-complete/route.ts",
    "app/api/stream/scheduled-start/route.ts",
    "app/api/stream/syndication/retry/route.ts",
    "app/api/integrations/keep-alive/route.ts",
    "app/api/announcements/weekly-draft/route.ts",
  ].map(read);
  for (const source of protectedRoutes) {
    assert.doesNotMatch(source, /searchParams\.get\("secret"\)/);
  }

  const relayBootstrap = read("infra/stream-relay/bootstrap.sh");
  const authProxy = read("infra/stream-relay/auth-proxy.py");
  const relayHook = read("infra/stream-relay/on-stream-ready.sh");
  const relaySanitizer = read("infra/stream-relay/sanitize-relay-log.py");
  assert.doesNotMatch(relayBootstrap, /publish-auth\?secret=/);
  assert.match(relayBootstrap, /http:\/\/127\.0\.0\.1:8091\/auth/);
  assert.match(authProxy, /"X-Stream-Relay-Secret": SECRET/);
  assert.match(authProxy, /def log_message[\s\S]+return/);
  assert.match(relayHook, /LOG_SANITIZER/);
  assert.match(relaySanitizer, /NAMED_SECRET/);
  assert.doesNotMatch(
    read("lib/stream/browser-publish-ws.ts"),
    /report\("recorder_error",\s*\{[^}]*message:/,
  );
});

test("webhook claim supports exclusive processing, crash recovery, and backoff", () => {
  const sql = read("supabase/migrations/0050_security_baseline.sql");
  const state = read("lib/stripe/webhook-state.ts");
  assert.match(sql, /on conflict \(event_id\) do nothing/);
  assert.match(sql, /status = 'processing'[\s\S]+lease_expires_at/);
  assert.match(sql, /status = 'retryable'[\s\S]+next_retry_at/);
  assert.match(sql, /lease_expires_at[\s\S]+<= clock_timestamp\(\)/);
  assert.match(state, /Math\.min\([\s\S]+60 \* 60 \* 1000\)/);
});

test("webhook reconciliation is tenant-bound and ignores older provider state", () => {
  const webhook = read("lib/stripe/webhooks.ts");
  assert.match(webhook, /\.eq\("stripe_account_id", stripeAccountId\)/);
  assert.match(webhook, /metadataChurchId !== data\.id/);
  assert.match(webhook, /\.eq\("church_id", params\.churchId\)/);
  assert.match(webhook, /stripe_event_created_at\.lte/);
  assert.match(webhook, /donation_reconciliation_failed/);
  assert.match(webhook, /subscription_reconciliation_failed/);
});

test("receipt failure remains retryable and email sends are idempotent", () => {
  const receipt = read("lib/stripe/receipt-delivery.ts");
  const email = read("lib/email/giving.ts");
  assert.match(receipt, /p_sent:\s*sent/);
  assert.match(receipt, /p_terminal:\s*terminal && !sent/);
  assert.match(receipt, /donation-receipt\/\$\{donationId\}/);
  assert.match(email, /"Idempotency-Key"/);
});

test("webhook signature uses raw bytes and public errors contain no payload", () => {
  const route = read("app/api/webhooks/stripe/route.ts");
  const webhook = read("lib/stripe/webhooks.ts");
  assert.match(route, /request\.arrayBuffer\(\)/);
  assert.match(route, /Invalid signature/);
  assert.doesNotMatch(route, /event\.data|error\.message/);
  assert.match(webhook, /default:\s*\n\s*break/);
  assert.match(webhook, /status: "processed"/);
});
