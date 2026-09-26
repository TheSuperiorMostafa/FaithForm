import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { encodeImpersonationNote } from "@/lib/auth/impersonation";
import { IMPERSONATION_COOKIE, impersonationNoteOwner } from "@/lib/auth/impersonation-note";

/**
 * `createClient()` reads through the service role whenever a validly signed
 * "acting as" note is present — checking the signature, not whose it is. A
 * platform admin who left a browser without signing out handed that to the
 * next person to sign in there, and row level security stopped applying to
 * them. The middleware now removes any note that is not the signed-in
 * person's before a page or action can build a client.
 */

// Read when a note is signed, not at import.
process.env.IMPERSONATION_SECRET ??= "test-impersonation-secret-0000000001";

const ADMIN = "11111111-1111-4111-8111-111111111111";

test("the edge reader names the note's owner, and nothing for junk", () => {
  const note = encodeImpersonationNote({
    churchId: "22222222-2222-4222-8222-222222222222",
    adminUserId: ADMIN,
    exp: Math.floor(Date.now() / 1000) + 600,
  });
  assert.ok(note);
  assert.equal(impersonationNoteOwner(note!), ADMIN);
  assert.equal(impersonationNoteOwner("not-a-note"), null);
  assert.equal(impersonationNoteOwner(""), null);
});

test("the middleware drops a note that is not the signed-in person's", () => {
  const source = readFileSync("lib/supabase/middleware.ts", "utf8");
  assert.match(source, /impersonationNoteOwner\(actingNote\) !== userId/);
  // After the session is known, before any gate returns.
  assert.ok(source.indexOf("impersonationNoteOwner(actingNote)") > source.indexOf("auth.getClaims()"));
  assert.ok(source.indexOf("impersonationNoteOwner(actingNote)") < source.indexOf("routeGate(request.nextUrl.pathname)"));
  // It must stay importable on the edge runtime.
  const edge = readFileSync("lib/auth/impersonation-note.ts", "utf8");
  assert.doesNotMatch(edge, /from "node:|next\/headers/);
  assert.equal(IMPERSONATION_COOKIE, "faithform:acting-as", "renaming it would strand live notes");
});
