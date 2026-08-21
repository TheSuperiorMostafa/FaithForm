import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignedPortalSession,
  generatePortalToken,
  verifySignedPortalSession,
} from "@/lib/giving/portal-session";

process.env.DONOR_PORTAL_SESSION_SECRET =
  "donor-session-secret-that-is-at-least-32-bytes";

const payload = {
  version: 2 as const,
  sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  churchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  donorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  exp: 2_000,
};

test("donor session rejects altered and expired cookies", () => {
  const cookie = buildSignedPortalSession(payload);
  const [encodedPayload, signature] = cookie.split(".");
  const alteredSignature = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.deepEqual(verifySignedPortalSession(cookie, 1_000), payload);
  assert.equal(
    verifySignedPortalSession(`${encodedPayload}.${alteredSignature}`, 1_000),
    null,
  );
  assert.equal(verifySignedPortalSession(cookie, 2_000), null);
});

test("portal magic tokens use cryptographic random material", () => {
  const first = generatePortalToken();
  const second = generatePortalToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 43);
});
