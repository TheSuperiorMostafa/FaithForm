import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { checkDns, dnsRecordsFor, domainHostnames, getDomainProvider, getDomainProviderReadiness, normalizeHostname, type ProviderResult } from "@/lib/sites/domains";

function configure(t: TestContext, overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ VERCEL_API_TOKEN: "test-token", VERCEL_PROJECT_ID: "prj_test", VERCEL_TEAM_ID: "team_test", NEXT_PUBLIC_SITE_ROOT_HOST: undefined, NEXT_PUBLIC_SITE_URL: "https://faithform.io", SITE_URL: undefined, INVITE_SITE_URL: undefined, SITE_DNS_A_RECORD: undefined, SITE_DNS_CNAME_TARGET: undefined, ...overrides })) {
    const before = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  return getDomainProvider();
}
const domain = (extra: Record<string, unknown> = {}) => ({ name: "church.example", projectId: "prj_test", verified: true, ...extra });
const configuration = (extra: Record<string, unknown> = {}) => ({ misconfigured: false, recommendedIPv4: [{ rank: 2, value: ["76.76.21.21"] }, { rank: 1, value: ["216.198.79.1", "216.198.79.2"] }], recommendedCNAME: [{ rank: 1, value: "church.vercel-dns-017.com." }], ...extra });
function success(result: ProviderResult) { if (!result.ok) assert.fail(result.error); return result; }
function failure(result: ProviderResult) { if (result.ok) assert.fail("expected failure"); return result; }

test("public suffix parsing supports international church domains, pasted URLs and IDNs", t => {
  configure(t);
  assert.deepEqual(normalizeHostname("HTTPS://Church.ORG.UK./about?from=nav"), { ok: true, hostname: "church.org.uk", isApex: true });
  assert.deepEqual(normalizeHostname("https://www.church.co.uk/"), { ok: true, hostname: "www.church.co.uk", isApex: false });
  assert.deepEqual(normalizeHostname("église.fr"), { ok: true, hostname: "xn--glise-9ra.fr", isApex: true });
  assert.equal(dnsRecordsFor("church.org.uk")[0].type, "A");
  assert.deepEqual(dnsRecordsFor("events.media.church.co.uk").map(r => [r.type, r.name]), [["CNAME", "events.media"]]);
  for (const invalid of ["co.uk", "org.uk", "github.io", "127.0.0.1", "0x7f000001", "[::1]", "https://user:password@church.org", "ftp://church.org", "bad_domain.org"]) assert.equal(normalizeHostname(invalid).ok, false, invalid);
});

test("platform and hosting addresses stay reserved even without the optional website root", t => {
  configure(t, { NEXT_PUBLIC_SITE_ROOT_HOST: undefined });
  for (const hostname of ["faithform.io", "www.faithform.io", "grace.faithform.io", "faithform.app", "faithform.vercel.app", "other.vercel.app", "test.now.sh"]) assert.equal(normalizeHostname(hostname).ok, false, hostname);
  assert.equal(normalizeHostname("faithform.io.church.example").ok, true);
});

test("domain plans reserve the apex and www together without rewriting normalized input", t => {
  configure(t);
  const expected = [{ hostname: "church.org.uk", redirectTo: null }, { hostname: "www.church.org.uk", redirectTo: "church.org.uk" }];
  assert.deepEqual(domainHostnames("church.org.uk"), expected);
  assert.deepEqual(domainHostnames("www.church.org.uk"), expected);
  assert.deepEqual(domainHostnames("visit.church.org.uk"), [{ hostname: "visit.church.org.uk", redirectTo: null }]);
  assert.equal((normalizeHostname("www.church.org.uk") as { hostname: string }).hostname, "www.church.org.uk");
});

test("provider readiness contains missing key names only and manual mode never calls an external API", async t => {
  configure(t, { VERCEL_API_TOKEN: undefined, VERCEL_PROJECT_ID: undefined });
  assert.deepEqual(getDomainProviderReadiness(), { configured: false, missing: ["VERCEL_API_TOKEN", "VERCEL_PROJECT_ID"] });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const provider = getDomainProvider();
  for (const method of [provider.register, provider.status, provider.verify, provider.remove]) assert.equal(success(await method("church.example")).serving, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test("registration retries confirm our project membership instead of accepting arbitrary conflicts", async t => {
  const provider = configure(t); let ownProject = false; let conflict = 409;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get("teamId"), "team_test");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    if (init?.method === "POST") { assert.equal(url.pathname, "/v10/projects/prj_test/domains"); return Response.json({ error: { message: "secret provider text" } }, { status: conflict }); }
    if (url.pathname.startsWith("/v6/domains/")) { assert.equal(url.searchParams.get("projectIdOrName"), "prj_test"); return Response.json(configuration()); }
    assert.equal(url.pathname, "/v9/projects/prj_test/domains/church.example");
    return ownProject ? Response.json(domain()) : Response.json({}, { status: 404 });
  });
  assert.equal(failure(await provider.register("church.example")).code, "conflict");
  ownProject = true; assert.equal(success(await provider.register("church.example")).serving, true);
  conflict = 400; assert.equal(success(await provider.register("church.example")).serving, true);
});

test("root and www registration preserves canonical redirects and repairs an interrupted retry", async t => {
  const provider = configure(t); let patched = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/v6/domains/")) return Response.json(configuration());
    if (init?.method === "POST") { assert.deepEqual(JSON.parse(String(init.body)), { name: "www.church.example", redirect: "church.example", redirectStatusCode: 308 }); return Response.json({}, { status: 409 }); }
    if (init?.method === "PATCH") { patched++; assert.deepEqual(JSON.parse(String(init.body)), { redirect: "church.example", redirectStatusCode: 308 }); return Response.json(domain({ name: "www.church.example", redirect: "church.example", redirectStatusCode: 308 })); }
    return Response.json(domain({ name: "www.church.example", redirect: "old.example", redirectStatusCode: 307 }));
  });
  assert.equal(success(await provider.register("www.church.example", { redirect: "church.example", redirectStatusCode: 308 })).redirect, "church.example");
  assert.equal(patched, 1);
});

test("project-specific DNS recommendations use preferred ranked values and preserve trailing CNAME dots", async t => {
  const provider = configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => { const url = new URL(String(input)); return Response.json(url.pathname.startsWith("/v6/") ? configuration() : domain({ name: url.pathname.endsWith("www.church.example") ? "www.church.example" : "church.example" })); });
  assert.deepEqual(success(await provider.status("church.example")).records?.map(r => [r.type, r.name, r.value]), [["A", "@", "216.198.79.1"]]);
  assert.deepEqual(success(await provider.status("www.church.example")).records?.map(r => [r.type, r.name, r.value]), [["CNAME", "www", "church.vercel-dns-017.com."]]);
});

test("ownership TXT challenges remain visible and DNS alone never marks unverified domains serving", async t => {
  const provider = configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => Response.json(new URL(String(input)).pathname.startsWith("/v6/") ? configuration() : domain({ verified: false, verification: [{ type: "TXT", domain: "_vercel.church.example", value: "vc-domain-verify=expected" }, { type: "TXT", domain: "_vercel.foreign.example", value: "unexpected" }] })));
  const result = success(await provider.status("church.example"));
  assert.equal(result.ownershipVerified, false); assert.equal(result.dnsConfigured, true); assert.equal(result.serving, false);
  assert.deepEqual(result.verification?.map(r => [r.type, r.name, r.value]), [["TXT", "_vercel", "vc-domain-verify=expected"]]);
});

test("verification uses the documented POST endpoint and rechecks project configuration", async t => {
  const provider = configure(t); let verified = false;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/v6/")) return Response.json(configuration());
    assert.equal(url.pathname, "/v9/projects/prj_test/domains/church.example/verify"); assert.equal(init?.method, "POST");
    return Response.json(domain({ verified }));
  });
  assert.equal(success(await provider.verify("church.example")).serving, false);
  verified = true; assert.equal(success(await provider.verify("church.example")).serving, true);
});

test("a verification challenge not ready yet returns current ownership instructions", async t => {
  const provider = configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") return Response.json({}, { status: 400 });
    if (url.pathname.startsWith("/v6/")) return Response.json({}, { status: 403 });
    return Response.json(domain({ verified: false, verification: [{ type: "TXT", domain: "_vercel.church.example", value: "vc-domain-verify=expected" }] }));
  });
  const result = success(await provider.verify("church.example")); assert.equal(result.serving, false); assert.equal(result.verification?.length, 1);
});

for (const [status, code, retryable] of [[429, "rate_limited", true], [503, "unavailable", true], [401, "unauthorized", false]] as const) {
  test(`provider ${status} stays distinct from confirmed bad DNS and does not expose raw errors`, async t => {
    const provider = configure(t);
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => new URL(String(input)).pathname.startsWith("/v6/") ? Response.json({ error: { message: "private upstream details" } }, { status, headers: { "retry-after": "120" } }) : Response.json(domain()));
    const result = failure(await provider.status("church.example"));
    assert.equal(result.code, code); assert.equal(result.retryable, retryable); assert.equal(result.retryAfterSeconds, 120); assert.doesNotMatch(result.error, /private upstream/);
  });
}

test("an unavailable project membership check cannot turn a retryable conflict into a terminal refusal", async t => {
  const provider = configure(t);
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => Response.json({}, { status: init?.method === "POST" ? 409 : 503 }));
  assert.equal(failure(await provider.register("church.example")).retryable, true);
});

test("malformed and foreign project responses fail closed before changes or serving claims", async t => {
  const provider = configure(t); let mode = "foreign"; let reads = 0;
  t.mock.method(globalThis, "fetch", async () => { reads++; return mode === "foreign" ? Response.json(domain({ projectId: "prj_other" })) : Response.json({ name: "church.example" }); });
  assert.equal(failure(await provider.status("church.example")).code, "unavailable");
  mode = "malformed"; assert.equal(failure(await provider.status("church.example")).code, "unavailable"); assert.equal(reads, 2);
});

test("network errors are recoverable and invalid hosts never reach the provider", async t => {
  const provider = configure(t); const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("private token URL"); });
  for (const method of [provider.register, provider.status, provider.verify, provider.remove]) assert.equal(failure(await method("church.example")).code, "unavailable");
  assert.equal(failure(await provider.register("faithform.io")).code, "invalid"); assert.equal(fetch.mock.callCount(), 4);
});

test("already removed domains are an idempotent success", async t => {
  const provider = configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => { assert.equal(new URL(String(input)).pathname, "/v9/projects/prj_test/domains/church.example"); assert.equal(init?.method, "DELETE"); return Response.json({}, { status: 404 }); });
  assert.equal(success(await provider.remove("church.example")).providerDomainId, null);
});

test("DNS resolver failures and SERVFAIL are unknown while NXDOMAIN is a confirmed pending record", async t => {
  configure(t); let dnsStatus = 2;
  t.mock.method(globalThis, "fetch", async () => Response.json({ Status: dnsStatus }));
  assert.equal((await checkDns("church.example")).available, false);
  dnsStatus = 3; const missing = await checkDns("church.example"); assert.equal(missing.available, true); assert.equal(missing.ok, false);
});

test("a partial DNS lookup failure cannot be used as evidence to disconnect a working site", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => new URL(String(input)).searchParams.get("type") === "1" ? Response.json({}, { status: 503 }) : Response.json({ Status: 0, Answer: [] }));
  const result = await checkDns("church.example"); assert.equal(result.available, false); assert.equal(result.ok, false);
});


test("a hostname assigned to a preview branch or custom environment is never called production-ready", async t => {
  const provider = configure(t); let assignment: Record<string, unknown> = { gitBranch: "staging" };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(domain(assignment)));
  assert.equal(failure(await provider.status("church.example")).code, "invalid");
  assignment = { customEnvironmentId: "env_preview" };
  assert.equal(failure(await provider.status("church.example")).code, "invalid");
  assert.equal(fetch.mock.callCount(), 2);
});
