import assert from "node:assert/strict";
import test from "node:test";
import { parseDomainCursor, withDomainSetup, type SiteDomainDetail } from "@/lib/sites/domain-queries";

test("family readiness includes a companion beyond the current admin page without exposing worker fields", async t => {
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://domain-reads.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-only-key";
  t.after(() => {
    for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", previous.url], ["SUPABASE_SECRET_KEY", previous.key]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  });
  const reads: URL[] = [];
  const common = { operation: "connect", records: [], verification: [], checked_at: null, available_at: null, last_error_code: null };
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); reads.push(url);
    assert.equal(url.hostname, "domain-reads.example.test");
    assert.doesNotMatch(url.searchParams.get("select") ?? "", /lease_token|lease_until|attempts/);
    return Response.json(url.searchParams.has("redirect_to")
      ? [{ ...common, domain_id: "other-page", redirect_to: "church.example", phase: "ownership", verification: [{ type: "TXT", name: "_vercel", value: "proof", note: "Ownership" }] }]
      : [{ ...common, domain_id: "root", redirect_to: null, phase: "ready" }]);
  });
  const row: SiteDomainDetail = { id: "root", churchId: "church-1", hostname: "church.example", isPrimary: true, status: "live", verifiedAt: "2026-01-01", dnsCheckedAt: null, dnsDetail: null, provider: "vercel", providerDomainId: null, notes: null, createdAt: "2026-01-01" };
  const [result] = await withDomainSetup([row]);
  assert.equal(result.setup?.phase, "ownership");
  assert.equal(result.setup?.verification[0]?.value, "proof");
  assert.equal(reads.length, 2);
  assert.match(reads.find(url => url.searchParams.has("redirect_to"))!.searchParams.get("site_domains.church_id")!, /church-1/);
});

test("admin cursors accept only a timestamp and canonical UUID", () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const valid = { createdAt: "2026-11-15T12:00:00.000Z", id: "12345678-1234-1234-1234-123456789abc" };
  assert.deepEqual(parseDomainCursor(encode(valid)), valid);
  assert.equal(parseDomainCursor(encode({ ...valid, id: "------------------------------------" })), null);
  assert.equal(parseDomainCursor(encode({ ...valid, createdAt: "2026-11-15),id.gt.0" })), null);
});
