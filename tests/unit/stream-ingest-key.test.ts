import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync("app/dashboard/live-streaming/actions.ts", "utf8");
const card = readFileSync("components/live-streaming/encoder-setup-card.tsx", "utf8");
const dashboard = readFileSync("app/dashboard/live-streaming/setup/page.tsx", "utf8");
const docs = readFileSync("components/live-streaming/encoder-docs-card.tsx", "utf8");

/**
 * Churches keep one permanent stream key. Reveal never mints a fresh expiring
 * capability; it returns the integration publish secret every time.
 */

test("a manual encoder gets the church's permanent stream key", () => {
  const body = actions.slice(actions.indexOf("export async function revealIngestKey("));
  const fn = body.slice(0, body.indexOf("export async function goLiveBroadcast("));
  assert.match(fn, /ensureStreamRelayCredentials\(auth\.churchId/);
  assert.match(fn, /getIntegrationPublishSecret\(auth\.churchId\)/);
  assert.match(fn, /buildStaticStreamName\(auth\.churchId, publishSecret\)/);
  assert.doesNotMatch(fn, /signIngestToken/);
  assert.doesNotMatch(fn, /expiresAt/);
});

test("the key is admin-only, audited, and rate limited", () => {
  const body = actions.slice(actions.indexOf("export async function revealIngestKey("));
  const fn = body.slice(0, body.indexOf("export async function goLiveBroadcast("));
  assert.match(fn, /if \(!auth\.isAdmin\)/);
  assert.match(fn, /assertRateLimit\(`stream:ingest-key:\$\{auth\.churchId\}`/);
  assert.match(fn, /logAdminAction\(/);
  assert.match(fn, /Revealed the church stream key/);
});

test("the key reaches the browser only as an action reply", () => {
  assert.match(card, /revealIngestKey\(\)/);
  assert.doesNotMatch(dashboard, /ingestKey/);
  assert.match(card, /Show stream key/);
  assert.match(card, /does not expire/);
  assert.doesNotMatch(card, /Lasts 4 hours/);
});

test("the encoder instructions point at the permanent key", () => {
  assert.match(docs, /stays the same until you replace it/);
  assert.match(docs, /Show stream key/);
  assert.doesNotMatch(docs, /fresh stream key/);
});

test("a revealed key hides itself, and replacing it is confirmed and refused while live", () => {
  assert.match(card, /KEY_VISIBLE_MS/);
  assert.match(card, /Replace stream key/);
  const rotate = readFileSync("app/dashboard/live-streaming/recording-actions.ts", "utf8");
  const fn = rotate.slice(rotate.indexOf("export async function rotateStreamKeyAction("));
  assert.match(fn, /requireAdmin\(\)/);
  assert.match(fn, /getActiveStreamSession/);
  assert.match(fn, /assertRateLimit\(`stream:rotate-key:\$\{auth\.churchId\}`/);
  assert.match(fn, /logAdminAction\(/);
  assert.doesNotMatch(fn, /console\.(log|info)\([^)]*secret/i);
});
