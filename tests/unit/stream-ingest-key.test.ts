import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync("app/dashboard/live-streaming/actions.ts", "utf8");
const card = readFileSync("components/live-streaming/encoder-setup-card.tsx", "utf8");
const dashboard = readFileSync(
  "components/live-streaming/live-streaming-dashboard.tsx",
  "utf8",
);
const docs = readFileSync("components/live-streaming/encoder-docs-card.tsx", "utf8");

/**
 * The persistent publish key was retired because it sat in public playback
 * URLs. What a church running OBS by hand gets instead is the same expiring
 * capability the paired encoder is handed, minted for a person: admin-only,
 * audited, rate limited, and never present in a page's initial props.
 */

test("a manual encoder can get a stream key, and it is the expiring kind", () => {
  assert.match(actions, /export async function revealIngestKey\(/);
  assert.match(actions, /signIngestToken\(auth\.churchId, \{ ttlSec \}\)/);
  assert.match(actions, /const ttlSec = MAX_INGEST_TTL_SEC/);
  assert.match(actions, /buildCapabilityStreamName\(auth\.churchId, token\)/);
  // Nothing here reads the persistent key back out of church_integrations.
  assert.doesNotMatch(actions, /access_token/);
});

test("the key is admin-only, audited, and rate limited", () => {
  const body = actions.slice(actions.indexOf("export async function revealIngestKey("));
  const fn = body.slice(0, body.indexOf("export async function goLiveBroadcast("));
  assert.match(fn, /if \(!auth\.isAdmin\)/);
  assert.match(fn, /assertRateLimit\(`stream:ingest-key:\$\{auth\.churchId\}`/);
  assert.match(fn, /logAdminAction\(/);
  assert.match(fn, /Revealed a stream key/);
});

test("the key reaches the browser only as an action reply", () => {
  // The card asks for it on click; the server page never hands it down.
  assert.match(card, /revealIngestKey\(\)/);
  assert.doesNotMatch(dashboard, /ingestKey/);
  assert.match(card, /Show stream key/);
  assert.match(card, /Lasts 4 hours/);
});

test("the encoder instructions point at the key that exists now", () => {
  assert.doesNotMatch(docs, /your church stream key/);
  assert.match(docs, /Show stream key/);
});
