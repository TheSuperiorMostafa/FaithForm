import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const account = readFileSync("lib/faithful/account.ts", "utf8");
const relationships = readFileSync("lib/faithful/relationships.ts", "utf8");

// ---------------------------------------------------------------------------
// First authenticated use materializes the visitor account
// ---------------------------------------------------------------------------
//
// The clients are allowed — encouraged — to act immediately after sign-in:
// the sign-up screen sends the typed display name, and a deep-linked
// invitation is posted before the first bootstrap. Both raced the row that
// bootstrap creates until these commands learned to ensure it themselves.

test("a profile write ensures the visitor account rather than requiring it", () => {
  const body = account.slice(
    account.indexOf("export async function updateVisitorProfile"),
    account.indexOf("export async function recordConsent"),
  );
  assert.match(body, /ensureVisitorAccount\(userId\)/);
  // The lifecycle guard must survive the change: deactivated and
  // deletion-requested accounts still may not mutate anything.
  assert.match(body, /account\.status !== "active"/);
});

test("redeeming an invitation ensures the visitor account rather than requiring it", () => {
  const body = relationships.slice(
    relationships.indexOf("export async function acceptJoinInvitation"),
  );
  assert.match(body, /ensureVisitorAccount\(userId\)/);
  assert.match(body, /account\.status !== "active"/);
  // And consumption stays one atomic call that refuses a blocked account.
  assert.match(body, /consume_visitor_invitation/);
});
