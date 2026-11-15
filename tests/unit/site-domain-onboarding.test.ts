import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { domainRetryDelay, processDomainClaim, requestDomainCheck, reserveDomainSetup, runDomainChecks, type DomainJobClaim } from "@/lib/sites/domain-onboarding";
import type { DomainProvider, ProviderResult } from "@/lib/sites/domains";
const now = Date.parse("2026-11-15T15:00:00Z");
const claim: DomainJobClaim = { domain_id: "domain-1", lease_token: "lease-1", attempts: 2, redirect_to: null, operation: "connect", phase: "connecting", records: [], verification: [] };
function provider(result: ProviderResult, calls: string[] = []): DomainProvider {
  return { name: "vercel", automated: true, register: async () => { calls.push("register"); return result; }, status: async () => result, verify: async () => { calls.push("verify"); return result; }, remove: async () => { calls.push("remove"); return result; } };
}
const healthy: ProviderResult = { ok: true, providerDomainId: "church.example", serving: true, ownershipVerified: true, dnsConfigured: true, records: [{ type: "A", name: "@", value: "1.2.3.4", note: "Website" }], verification: [] };
function fixture(t: import("node:test").TestContext, options: { complete?: boolean; claimError?: boolean } = {}) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const client = createClient("https://worker.example.test", "safe-service-key", { auth: { persistSession: false } });
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(resource));
    assert.equal(url.hostname, "worker.example.test");
    const endpoint = url.pathname.split("/").pop()!;
    if (endpoint === "site_domains") return Response.json({ id: claim.domain_id, church_id: "church-1", hostname: "church.example", status: "live", verified_at: "2026-01-01", churches: { slug: "church-slug" } });
    if (endpoint === "site_settings") return Response.json({ is_published: true });
    const body = JSON.parse(String(init?.body ?? "{}")); writes.push({ path: endpoint, body });
    if (endpoint === "reserve_site_domain_setup") return Response.json({ ok: true, domainId: "saved" });
    if (endpoint === "claim_site_domain_jobs") return options.claimError ? Response.json({ message: "unavailable" }, { status: 503 }) : Response.json([]);
    return Response.json(options.complete ?? true);
  });
  return { client, writes };
}

test("connection reserves root and www together before provider work, including retry metadata", async t => {
  const { client, writes } = fixture(t);
  assert.deepEqual(await reserveDomainSetup({ churchId: "church-1", hostname: "www.example.co.uk", userId: "user-1", details: { contact_email: "it@example.co.uk" } }, client), { ok: true, hostname: "example.co.uk", domainId: "saved" });
  assert.deepEqual(writes[0], { path: "reserve_site_domain_setup", body: { p_church_id: "church-1", p_hostname: "example.co.uk", p_companion: "www.example.co.uk", p_requested_by: "user-1", p_details: { contact_email: "it@example.co.uk" } } });
});
test("rate limits defer with Retry-After and cannot activate or demote a live routing row", async t => {
  const { client, writes } = fixture(t);
  await processDomainClaim(claim, client, { provider: () => provider({ ok: false, error: "Try later", code: "rate_limited", retryable: true, retryAfterSeconds: 3600 }), probe: async () => { throw new Error("must not probe"); }, now: () => now });
  const final = writes.at(-1)!.body;
  assert.equal(final.p_activate, false); assert.equal(final.p_error_code, "rate_limited");
  assert.ok(Date.parse(String(final.p_next_check_at)) >= now + 3600_000);
  assert.equal(writes.some(write => write.path === "site_domains"), false);
});
test("ownership challenges survive retries and never become an online claim", async t => {
  const { client, writes } = fixture(t), calls: string[] = [];
  const waiting: ProviderResult = { ...healthy, ok: true, serving: false, ownershipVerified: false, verification: [{ type: "TXT", name: "_vercel", value: "proof", note: "Ownership" }] };
  await processDomainClaim(claim, client, { provider: () => provider(waiting, calls), probe: async () => { throw new Error("must not probe"); }, now: () => now });
  assert.deepEqual(calls, ["register", "verify"]);
  assert.equal(writes.at(-1)!.body.p_phase, "ownership"); assert.equal(writes.at(-1)!.body.p_activate, false);
  assert.deepEqual(writes.at(-1)!.body.p_verification, waiting.verification);
});
test("a verification outage keeps the newly issued ownership and DNS instructions", async t => {
  const { client, writes } = fixture(t);
  const waiting: ProviderResult = { ...healthy, ownershipVerified: false, verification: [{ type: "TXT", name: "_vercel", value: "new-proof", note: "Ownership" }] };
  const host = provider(waiting);
  host.verify = async () => ({ ok: false, code: "unavailable", error: "Host unavailable", retryable: true });
  await processDomainClaim(claim, client, { provider: () => host, probe: async () => { throw new Error("must not probe"); }, now: () => now });
  assert.deepEqual(writes.at(-1)!.body.p_verification, waiting.verification);
  assert.deepEqual(writes.at(-1)!.body.p_records, healthy.records);
  assert.equal(writes.at(-1)!.body.p_phase, "ownership");
});
test("credential failures pause work until an explicit retry instead of polling forever", async t => {
  const { client, writes } = fixture(t);
  await processDomainClaim({ ...claim, operation: "disconnect" }, client, { provider: () => provider({ ok: false, code: "unauthorized", error: "Reconnect host", retryable: false }), probe: async () => ({ ok: true }), now: () => now });
  assert.equal(writes.at(-1)!.body.p_next_check_at, null);
  assert.equal(writes.at(-1)!.body.p_activate, false);
  assert.equal(writes.some(write => write.path === "finish_site_domain_disconnect"), false);
});
test("manual retry uses the scoped atomic family scheduler", async t => {
  const { client, writes } = fixture(t);
  assert.equal(await requestDomainCheck("church-1", "domain-1", client), true);
  assert.deepEqual(writes, [{ path: "request_site_domain_check", body: { p_church_id: "church-1", p_domain_id: "domain-1" } }]);
});
test("DNS and HTTPS are separate gates; a configured provider cannot prove the website", async t => {
  const { client, writes } = fixture(t);
  await processDomainClaim(claim, client, { provider: () => provider(healthy), probe: async input => { assert.equal(input.slug, "church-slug"); assert.equal(input.published, true); return { ok: false, code: "wrong_website" }; }, now: () => now });
  assert.equal(writes.at(-1)!.body.p_phase, "https"); assert.equal(writes.at(-1)!.body.p_activate, false);
});
test("only the correct HTTPS website activates a fenced job; stale completions cannot claim success", async t => {
  const { client, writes } = fixture(t, { complete: false });
  const result = await processDomainClaim(claim, client, { provider: () => provider(healthy), probe: async () => ({ ok: true }), now: () => now });
  assert.equal(result, "stale"); assert.equal(writes.at(-1)!.body.p_activate, true); assert.equal(writes.at(-1)!.body.p_lease_token, "lease-1");
});
test("disconnect retries release the provider before fenced database deletion and never register", async t => {
  const { client, writes } = fixture(t), calls: string[] = [];
  assert.equal(await processDomainClaim({ ...claim, operation: "disconnect" }, client, { provider: () => provider(healthy, calls), probe: async () => { throw new Error("no probe"); }, now: () => now }), "removed");
  assert.deepEqual(calls, ["remove"]); assert.equal(writes.at(-1)!.path, "finish_site_domain_disconnect");
  assert.deepEqual(writes.at(-1)!.body, { p_domain_id: "domain-1", p_lease_token: "lease-1" });
});
test("claim read failures are reported as failed work, not an empty successful queue", async t => {
  const { client } = fixture(t, { claimError: true });
  const result = await runDomainChecks({ client, deps: { provider: () => provider(healthy), probe: async () => ({ ok: true }), now: () => now } });
  assert.equal(result.failed, true); assert.equal(result.checked, 0);
});
test("backoff is bounded, jittered and respects provider delays", () => {
  assert.ok(domainRetryDelay(1, "a") >= 60000);
  assert.notEqual(domainRetryDelay(1, "a"), domainRetryDelay(1, "b"));
  assert.ok(domainRetryDelay(1000, "a") <= 24 * 3600_000);
  assert.ok(domainRetryDelay(1, "a", 3600) >= 3600_000);
});
