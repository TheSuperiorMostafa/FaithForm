import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { issueInvitation } from "@/lib/faithform/invitations";

const churchId = "11111111-1111-4111-8111-111111111111";
const memberId = "12345678-1234-1234-1234-123456789abc";
const staffUserId = "22222222-2222-4222-8222-222222222222";

function database(t: TestContext, belongsToChurch = true) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://people-invitation.example.test", SUPABASE_SECRET_KEY: "safe-test-key" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const writes: Record<string, unknown>[] = [];
  const fetch = t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "people-invitation.example.test");
    if (url.pathname.endsWith("/members")) {
      assert.equal(url.searchParams.get("id"), `eq.${memberId}`);
      assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
      return Response.json(belongsToChurch ? { id: memberId } : null);
    }
    assert.equal(url.pathname, "/rest/v1/visitor_invitations");
    assert.equal(init?.method, "POST");
    const payload = JSON.parse(String(init.body)); writes.push(payload);
    return Response.json({ id: "33333333-3333-4333-8333-333333333333", purpose: payload.purpose, expires_at: payload.expires_at });
  });
  return { writes, fetch };
}

const input = { churchId, staffUserId, baseUrl: "https://church.example.test", payload: { purpose: "people_claim", memberId } };

test("an invitation accepts an imported PostgreSQL person ID and retains its tenant and hashed-token checks", async t => {
  const db = database(t);
  const result = await issueInvitation(input);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].church_id, churchId);
  assert.equal(db.writes[0].member_id, memberId);
  assert.equal(db.writes[0].created_by, staffUserId);
  assert.match(String(db.writes[0].token_hash), /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(db.writes[0], "token"), false);
  assert.equal(new URL(result.url).origin, input.baseUrl);
  assert.equal(result.purpose, "people_claim");
});

test("an imported ID from another church cannot receive a person invitation", async t => {
  const db = database(t, false);
  await assert.rejects(issueInvitation(input), /not in this church/);
  assert.equal(db.writes.length, 0);
});

test("malformed IDs are refused before any invitation database request", async t => {
  const db = database(t);
  for (const invalid of ["", "not-a-person", memberId.replaceAll("-", ""), `${memberId}/other`]) {
    await assert.rejects(issueInvitation({ ...input, payload: { purpose: "people_claim", memberId: invalid } }), /Check the values/);
  }
  assert.equal(db.fetch.mock.callCount(), 0);
});
