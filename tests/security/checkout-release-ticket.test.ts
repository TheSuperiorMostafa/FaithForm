import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mintReleaseTicket, verifyReleaseTicket } from "@/lib/checkin/checkout-ticket";

/**
 * Kids checkout took the verification method from the browser. Anyone with
 * Check-In could release any child as "code checked" with no code and no
 * written reason, to anyone. A code or QR release now needs the ticket the
 * server issued when it actually checked that family's code, and the adult
 * named must be on that family's list.
 */

process.env.ATTENDANCE_QR_SECRET ??= "test-attendance-qr-secret-0000000000000000000001";

const ticket = {
  churchId: "11111111-1111-4111-8111-111111111111",
  householdId: "22222222-2222-4222-8222-222222222222",
  method: "code" as const,
  staffUserId: "33333333-3333-4333-8333-333333333333",
};

test("a ticket is good only for its church, staff member and method", (t) => {
  const token = mintReleaseTicket(ticket);
  if (!token) {
    t.skip("no check-in signing key configured in this environment");
    return;
  }
  const expected = { churchId: ticket.churchId, staffUserId: ticket.staffUserId, method: "code" as const };
  assert.deepEqual(verifyReleaseTicket(token, expected), { householdId: ticket.householdId });
  assert.equal(verifyReleaseTicket(token, { ...expected, churchId: "44444444-4444-4444-8444-444444444444" }), null);
  assert.equal(verifyReleaseTicket(token, { ...expected, staffUserId: "55555555-5555-4555-8555-555555555555" }), null);
  assert.equal(verifyReleaseTicket(token, { ...expected, method: "qr" }), null);
  assert.equal(verifyReleaseTicket(undefined, expected), null);
  assert.equal(verifyReleaseTicket(`${token.slice(0, -2)}xx`, expected), null);
});

test("the release proves the method, the family and the adult on the server", () => {
  const source = readFileSync("app/dashboard/checkin/actions.ts", "utf8");
  const sql = readFileSync("supabase/migrations/0116_atomic_child_checkout.sql", "utf8");
  const release = source.slice(source.indexOf("export async function completeCheckout"));
  const body = release.slice(0, release.indexOf("\n}\n"));
  assert.match(body, /verifyReleaseTicket\(input\.ticket/);
  assert.match(body, /p_expected_household_id: householdId/);
  assert.match(sql, /v_household_id <> p_expected_household_id/);
  assert.match(sql, /public\.household_pickup_authorizations pa/);
  assert.match(sql, /hm\.relationship = 'guardian'/);
  assert.match(sql, /pa\.revoked_at is null/);
  assert.ok(body.indexOf("verifyReleaseTicket") < body.indexOf('rpc("release_checkin_sessions"'));

  const lookup = source.slice(source.indexOf("export async function lookupCheckoutCredential"));
  assert.match(lookup.slice(0, lookup.indexOf("\n}\n")), /mintReleaseTicket\(/);

  const console = readFileSync("components/checkin/checkout-console.tsx", "utf8");
  assert.match(console, /ticket: overrideMode \? undefined : lookup\.ticket/);
});
