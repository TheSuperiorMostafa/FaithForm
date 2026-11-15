import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { isPublicDomainAddress, probeChurchDomain, type DomainProbeDependencies, type ProbeHttpResponse } from "@/lib/sites/domain-probe";
import { createDomainProbe, domainProbeProof, validDomainProbe, validDomainProof } from "@/lib/sites/domain-probe-token";

function configure(t: TestContext, configured = true) {
  for (const [key, value] of Object.entries({ DOMAIN_PROBE_SECRET: configured ? "safe-test-only-domain-probe-secret" : undefined, SUPABASE_SECRET_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined })) {
    const previous = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
const input = { hostname: "grace.example", slug: "grace", published: true };
const publicAddress = { address: "76.76.21.21", family: 4 };
function dependencies(request: DomainProbeDependencies["request"], resolve: DomainProbeDependencies["resolve"] = async () => [publicAddress]): DomainProbeDependencies { return { resolve, request }; }
async function signedResponse(hostname: string, token: string, options: Partial<ProbeHttpResponse> = {}, slug = input.slug): Promise<ProbeHttpResponse> {
  return { status: 200, proof: await domainProbeProof(hostname, slug, token), location: null, body: `<main data-site="${slug}">Church website</main>`, ...options };
}

test("probe requests and proofs are short lived, host bound, slug bound, and purpose separated", async t => {
  configure(t); const now = Date.now(); const token = await createDomainProbe(input.hostname, now); assert.ok(token);
  assert.equal(await validDomainProbe(input.hostname, token, now), true);
  assert.equal(await validDomainProbe("other.example", token, now), false);
  assert.equal(await validDomainProbe(input.hostname, token, now + 121_000), false);
  assert.equal(await validDomainProbe(input.hostname, token, now - 20_000), false);
  const proof = await domainProbeProof(input.hostname, input.slug, token); assert.ok(proof);
  assert.equal(await validDomainProof(input.hostname, input.slug, token, proof), true);
  assert.equal(await validDomainProof("other.example", input.slug, token, proof), false);
  assert.equal(await validDomainProof(input.hostname, "other-church", token, proof), false);
  assert.equal(await validDomainProof(input.hostname, input.slug, token, token.split(".").at(-1)!), false);
  for (const malformed of [null, "", "unsigned", `${token}x`, token.slice(0, -1) + (token.endsWith("0") ? "1" : "0")]) assert.equal(await validDomainProbe(input.hostname, malformed, now), false);
});

test("probes fail closed without a signing secret", async t => {
  configure(t, false);
  assert.equal(await createDomainProbe(input.hostname), null);
  assert.equal(await validDomainProbe(input.hostname, "unsigned"), false);
  let requested = false;
  assert.deepEqual(await probeChurchDomain(input, dependencies(async () => { requested = true; throw new Error("unexpected"); })), { ok: false, code: "website_unavailable" });
  assert.equal(requested, false);
});

test("only globally routable addresses are accepted, including canonical and expanded IPv6 forms", () => {
  for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.2.10", "192.168.1.1", "192.88.99.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "fe80::1", "fc00::1", "ff02::1", "2001:db8::1", "2001:0db8::1", "2001::1", "2001:0000::1", "2001:2::1", "2002:808:808::1", "3fff:1::1", "not-an-address"]) assert.equal(isPublicDomainAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "76.76.21.21", "216.198.79.1", "2001:4860:4860::8888", "2606:4700:4700::1111", "2a00:1450:4001::200e"]) assert.equal(isPublicDomainAddress(address), true, address);
});

test("mixed public and private DNS answers never reach the HTTP client", async t => {
  configure(t); let requested = false;
  const result = await probeChurchDomain(input, dependencies(async () => { requested = true; throw new Error("unexpected"); }, async () => [publicAddress, { address: "169.254.169.254", family: 4 }]));
  assert.deepEqual(result, { ok: false, code: "unsafe_address" }); assert.equal(requested, false);
});

test("DNS is resolved once and the vetted address is pinned for the TLS request", async t => {
  configure(t); let resolutions = 0; let requests = 0;
  const result = await probeChurchDomain(input, dependencies(async (host, address, token) => {
    requests++; assert.equal(host, input.hostname); assert.deepEqual(address, publicAddress); assert.equal(await validDomainProbe(host, token), true);
    return signedResponse(host, token);
  }, async () => ++resolutions === 1 ? [publicAddress, { address: "1.1.1.1", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]));
  assert.deepEqual(result, { ok: true }); assert.equal(resolutions, 1); assert.equal(requests, 1);
});

test("DNS and TLS errors are recoverable checks, with no redirect or alternate-host fallback", async t => {
  configure(t);
  assert.deepEqual(await probeChurchDomain(input, dependencies(async () => { throw new Error("TLS certificate pending"); })), { ok: false, code: "https_pending" });
  assert.deepEqual(await probeChurchDomain(input, dependencies(async () => { throw new Error("must not request"); }, async () => { throw new Error("DNS pending"); })), { ok: false, code: "name_unavailable" });
  assert.deepEqual(await probeChurchDomain(input, dependencies(async () => { throw new Error("must not request"); }, async () => [])), { ok: false, code: "name_unavailable" });
});

test("published pages need a fresh response proof and the expected church marker", async t => {
  configure(t);
  assert.deepEqual(await probeChurchDomain(input, dependencies((host, _address, token) => signedResponse(host, token))), { ok: true });
  for (const options of [{ proof: null }, { proof: "a".repeat(64) }, { body: '<main data-site="foreign-church">Wrong church</main>' }, { body: "FaithForm landing page" }, { status: 404 }]) {
    const result = await probeChurchDomain(input, dependencies((host, _address, token) => signedResponse(host, token, options)));
    assert.equal(result.ok, false, JSON.stringify(options));
  }
});

test("cross-host, cross-church, and stale captured response proofs never pass a new probe", async t => {
  configure(t);
  for (const [host, slug] of [["other.example", input.slug], [input.hostname, "other-church"]]) {
    assert.equal((await probeChurchDomain(input, dependencies((_host, _address, token) => signedResponse(host, token, {}, slug)))).ok, false);
  }
  const oldToken = (await createDomainProbe(input.hostname, Date.now() - 180_000))!;
  const capturedProof = await domainProbeProof(input.hostname, input.slug, oldToken);
  assert.equal((await probeChurchDomain(input, dependencies(async () => ({ status: 200, proof: capturedProof, location: null, body: '<main data-site="grace"></main>' })))).ok, false);
});

test("draft connectivity accepts a signed 404 without publishing or exposing draft content", async t => {
  configure(t); const draft = { ...input, published: false };
  assert.deepEqual(await probeChurchDomain(draft, dependencies((host, _address, token) => signedResponse(host, token, { status: 404, body: "Not found" }))), { ok: true });
  assert.equal((await probeChurchDomain(draft, dependencies((host, _address, token) => signedResponse(host, token, { status: 404, proof: null, body: "Not found" })))).ok, false);
  assert.equal((await probeChurchDomain(draft, dependencies((host, _address, token) => signedResponse(host, token, { body: '<main data-site="other-church"></main>' })))).ok, false);
});

test("only the explicit paired www redirect is accepted and is never followed", async t => {
  configure(t); const alias = { ...input, hostname: "www.grace.example", redirectTo: "grace.example" }; let calls = 0;
  const response = (status: number, location: string | null) => dependencies(async () => { calls++; return { status, proof: null, location, body: "" }; });
  assert.deepEqual(await probeChurchDomain(alias, response(308, "https://grace.example/")), { ok: true });
  assert.equal(calls, 1);
  for (const [status, location] of [[302, "https://grace.example/"], [308, "http://grace.example/"], [308, "https://other.example/"], [308, "https://grace.example/other"], [308, "https://grace.example/?next=bad"], [308, "https://grace.example/#fragment"], [308, "https://user:pass@grace.example/"], [308, null]] as const) assert.equal((await probeChurchDomain(alias, response(status, location))).ok, false, String(location));
  assert.equal((await probeChurchDomain({ ...input, redirectTo: "other.example" }, response(308, "https://other.example/"))).ok, false, "an arbitrary domain pair is never an alias proof");
});
