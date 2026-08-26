import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("billing portal requires the verified church/donor session", () => {
  const route = read("app/api/give/portal/route.ts");
  const service = read("lib/giving/portal-billing.ts");
  assert.match(route, /getDonorPortalSession\(parsed\.data\.slug\)/);
  assert.match(route, /createAuthorizedBillingPortal/);
  assert.match(service, /\.eq\("church_id", churchId\)/);
  assert.match(service, /\.eq\("donor_id", donorId\)/);
  assert.match(service, /church\.churchId !== session\.churchId/);
  assert.doesNotMatch(route, /email:\s*z\.string/);
  assert.doesNotMatch(route, /ilike\("donor_email"/);
});

test("unknown portal-link requests do not create or enumerate donors", () => {
  const route = read("app/api/give/portal/send-link/route.ts");
  assert.doesNotMatch(route, /upsertGivingDonor/);
  assert.match(route, /if \(!existingDonor\?\.id\) return generic/);
  assert.match(route, /If that donor account exists/);
});

test("magic-link consumption is one atomic replay-safe mutation", () => {
  const migration = read("supabase/migrations/0050_security_baseline.sql");
  const functionSql = migration.slice(
    migration.indexOf("consume_donor_portal_token"),
    migration.indexOf("-- INTEGRATIONS"),
  );
  assert.match(functionSql, /update public\.donor_portal_sessions/);
  assert.match(functionSql, /s\.used_at is null/);
  assert.match(functionSql, /s\.expires_at > clock_timestamp\(\)/);
  assert.match(functionSql, /d\.portal_access_revoked_at is null/);
  assert.match(functionSql, /s\.church_id = c\.id/);
  assert.doesNotMatch(functionSql, /select[\s\S]+update[\s\S]+used_at/i);
});

test("stream cancellation and moderation include authenticated tenant predicates", () => {
  const events = read("lib/stream/events.ts");
  const chat = read("lib/stream/chat.ts");
  const actions = read("app/dashboard/live-streaming/actions.ts");
  assert.match(events, /\.eq\("id", eventId\)\s*\.eq\("church_id", churchId\)/);
  assert.match(chat, /\.eq\("id", messageId\)\s*\.eq\("church_id", churchId\)/);
  assert.match(actions, /cancelStreamEvent\(eventId, auth\.churchId\)/);
});

test("public chat and views validate publication relationships", () => {
  const chat = read("lib/stream/chat.ts");
  const views = read("lib/stream/media-library.ts");
  assert.match(chat, /\.eq\("status", "live"\)/);
  assert.match(chat, /\.eq\("chat_enabled", true\)/);
  assert.match(chat, /\.eq\("public_access", true\)/);
  assert.match(views, /\.eq\("church_id", input\.churchId\)/);
  assert.match(views, /Invalid media view relationship/);
});

test("browser and native stream surfaces cannot serialize the persistent publish key", () => {
  const status = read("app/api/stream/public-status/route.ts");
  const browserPublish = read("app/api/stream/browser-publish/route.ts");
  const dashboard = read("app/dashboard/live-streaming/actions.ts");
  const encoderPoll = read("app/api/stream/encoder/poll/route.ts");
  const encoder = read("lib/stream/encoder.ts");
  const encoderAgent = read("infra/stream-agent/faithform-stream-agent.mjs");
  const publishAuth = read("app/api/stream/publish-auth/route.ts");
  assert.doesNotMatch(status, /publishKey|streamName|streamPath/);
  assert.doesNotMatch(browserPublish, /includeSecret:\s*true|streamPath:/);
  assert.doesNotMatch(dashboard, /publishKey\?:|streamName\?:/);
  assert.match(encoderPoll, /signIngestToken/);
  assert.match(encoderPoll, /delete safePayload\.streamKey/);
  assert.doesNotMatch(encoder, /streamKey:/);
  assert.doesNotMatch(encoderAgent, /data\.streamKey|config\.streamKey/);
  assert.match(publishAuth, /verifyIngestToken/);
  assert.match(publishAuth, /legacyCredentialInPath/);
  assert.match(publishAuth, /capability\.churchId !== parsedPath\.churchId/);
  assert.doesNotMatch(publishAuth, /integration\.access_token\s*!==/);
  assert.match(publishAuth, /STREAM_RELAY_PLAYBACK_SECRET/);
  assert.match(publishAuth, /body\.action === "read"/);
  // The relay's Basic credential is attached to the *upstream* request and
  // never returned. Prompt 9 moved that half into `lib/stream/relay-upstream`
  // so the website route and Faithful's header-authenticated live route reach
  // the relay through one contract instead of two copies that could drift.
  //
  // The property is therefore asserted in its new home — and, more strongly
  // than before, that neither route builds a credential of its own.
  const relayUpstream = read("lib/stream/relay-upstream.ts");
  assert.match(relayUpstream, /Authorization: authorization/);
  assert.match(relayUpstream, /STREAM_RELAY_PLAYBACK_SECRET/);
  // Nothing returns it. It is assembled, attached, and forgotten.
  assert.doesNotMatch(relayUpstream, /return .*playbackAuthorization\(\)/);

  for (const route of [
    "app/api/stream/hls/[...path]/route.ts",
    "app/api/media/v1/live/[...path]/route.ts",
  ]) {
    const source = read(route);
    assert.match(source, /fetchFromRelay\(\{/, `${route} does not use the shared relay module`);
    assert.doesNotMatch(
      source,
      /STREAM_RELAY_PLAYBACK_SECRET|faithform-playback:/,
      `${route} builds its own relay credential`,
    );
  }
});

test("integration raw token reads and writes require the server client", () => {
  const tokens = read("lib/integrations/tokens.ts");
  const rawReader = tokens.slice(
    tokens.indexOf("export async function getIntegration("),
    tokens.indexOf("export type SaveIntegrationInput"),
  );
  assert.match(rawReader, /createAdminClientOrNull/);
  assert.doesNotMatch(rawReader, /get_church_integration_tokens/);
  assert.doesNotMatch(tokens, /if \(supabase\) \{[\s\S]{0,180}church_integrations/);
});

test("Stripe events and receipts use leased atomic claims", () => {
  const webhook = read("lib/stripe/webhooks.ts");
  const state = read("lib/stripe/webhook-state.ts");
  const receipt = read("lib/stripe/receipt-delivery.ts");
  assert.match(webhook, /claimStripeEvent\(event\.id, event\.type\)/);
  assert.match(webhook, /completeStripeEvent/);
  assert.match(state, /claim_stripe_webhook_event/);
  assert.match(receipt, /claim_donation_receipt/);
  assert.match(receipt, /complete_donation_receipt/);
  assert.match(webhook, /stripe_event_created_at\.lte/);
  assert.match(webhook, /idempotencyKey: `failed-invoice\/\$\{invoice\.id\}`/);
  assert.doesNotMatch(webhook, /receipt_email_sent_at:\s*now/);
});
