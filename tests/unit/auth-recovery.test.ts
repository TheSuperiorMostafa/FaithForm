import assert from "node:assert/strict";
import test from "node:test";

import { sessionCameFromRecovery } from "../../lib/auth/recovery";

function tokenWith(payload: object): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

// ---------------------------------------------------------------------------
// A reset link sets a password, full stop
// ---------------------------------------------------------------------------
//
// The `next` instruction on a recovery redirect dies whenever Supabase falls
// back to the bare Site URL, so the callback reads the session's own `amr`
// claim instead. These pin the reading.

test("a session minted by a recovery link is recognised", () => {
  const token = tokenWith({
    sub: "user-1",
    amr: [{ method: "recovery", timestamp: 1_700_000_000 }],
  });
  assert.equal(sessionCameFromRecovery(token), true);
});

test("only the freshest method counts — history cannot hijack a sign-in", () => {
  const magicLinkAfterOldRecovery = tokenWith({
    amr: [
      { method: "recovery", timestamp: 1_600_000_000 },
      { method: "otp", timestamp: 1_700_000_000 },
    ],
  });
  assert.equal(sessionCameFromRecovery(magicLinkAfterOldRecovery), false);

  const recoveryAfterOldPassword = tokenWith({
    amr: [
      { method: "password", timestamp: 1_600_000_000 },
      { method: "recovery", timestamp: 1_700_000_000 },
    ],
  });
  assert.equal(sessionCameFromRecovery(recoveryAfterOldPassword), true);
});

test("ordinary sign-ins are not recognised", () => {
  for (const method of ["password", "otp", "magiclink", "oauth"]) {
    const token = tokenWith({ amr: [{ method, timestamp: 1_700_000_000 }] });
    assert.equal(sessionCameFromRecovery(token), false, method);
  }
});

test("anything unreadable fails closed to a normal sign-in", () => {
  assert.equal(sessionCameFromRecovery(undefined), false);
  assert.equal(sessionCameFromRecovery(""), false);
  assert.equal(sessionCameFromRecovery("not-a-jwt"), false);
  assert.equal(sessionCameFromRecovery("a.!!!not-base64!!!.c"), false);
  assert.equal(sessionCameFromRecovery(tokenWith({ amr: [] })), false);
  assert.equal(sessionCameFromRecovery(tokenWith({ sub: "no-amr" })), false);
});
