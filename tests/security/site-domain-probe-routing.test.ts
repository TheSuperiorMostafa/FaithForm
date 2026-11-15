import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { rewriteChurchSite } from "@/lib/sites/tenant";
import { createDomainProbe, validDomainProof } from "@/lib/sites/domain-probe-token";

function configure(t: TestContext) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SITE_URL: "https://app.probe.example", NEXT_PUBLIC_SITE_ROOT_HOST: "faithform.test", NEXT_PUBLIC_SUPABASE_URL: "https://probe-database.example", DOMAIN_PROBE_SECRET: "safe-test-only-domain-proof-secret", SUPABASE_SECRET_KEY: "safe-supabase-fixture-key", SITE_URL: undefined, INVITE_SITE_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: "deployment.vercel.app", VERCEL_URL: "deployment.vercel.app" })) {
    const before = process.env[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}
function request(host: string, token?: string | null, path = "/") { return new NextRequest(`https://${host}${path}`, { headers: { host, ...(token ? { "x-faithform-domain-probe": token } : {}) } }); }
function lookupFixture(t: TestContext, expectedHost: string, probes: boolean[] = []) {
  return t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://probe-database.example"); assert.equal(url.pathname, "/rest/v1/site_domains");
    assert.equal(url.searchParams.get("hostname"), `eq.${expectedHost}`); assert.equal(url.searchParams.get("limit"), "1");
    const probe = !url.searchParams.has("status"); probes.push(probe);
    if (!probe) { assert.equal(url.searchParams.get("status"), "eq.live"); assert.equal(url.searchParams.get("verified_at"), "not.is.null"); }
    return Response.json(probe ? [{ churches: { slug: "grace" } }] : []);
  });
}

test("a signed probe can test its reserved pending hostname but does not grant public routing afterward", async t => {
  configure(t); const host = "pending-signed-probe.example"; const probes: boolean[] = []; const fetch = lookupFixture(t, host, probes);
  const token = await createDomainProbe(host); assert.ok(token);
  const response = await rewriteChurchSite(request(host, token)); assert.ok(response);
  assert.equal(new URL(response.headers.get("x-middleware-rewrite")!).pathname, "/sites/grace");
  assert.equal(new URL(response.headers.get("x-middleware-rewrite")!).search, "", "routing must never add preview=1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await validDomainProof(host, "grace", token, response.headers.get("x-faithform-domain-proof")), true);
  assert.equal(await validDomainProof(host, "foreign", token, response.headers.get("x-faithform-domain-proof")), false);
  assert.equal((await rewriteChurchSite(request(host)))?.status, 404);
  assert.deepEqual(probes, [true, false]); assert.equal(fetch.mock.callCount(), 2, "a signed result must not populate the public hostname cache");
});

test("signed pending probes bypass a cached miss without promoting the public mapping", async t => {
  configure(t); const host = "cached-miss-probe.example"; const probes: boolean[] = []; lookupFixture(t, host, probes);
  assert.equal((await rewriteChurchSite(request(host)))?.status, 404);
  const token = await createDomainProbe(host); assert.ok(token);
  assert.ok((await rewriteChurchSite(request(host, token)))?.headers.get("x-middleware-rewrite"));
  assert.equal((await rewriteChurchSite(request(host)))?.status, 404);
  assert.deepEqual(probes, [false, true]);
});

test("unsigned, malformed, forged, expired, and cross-host probes retain the live verified domain filters", async t => {
  configure(t);
  const cases = ["unsigned", "malformed", "forged", "expired", "foreign"];
  for (const [index, kind] of cases.entries()) {
    const host = `untrusted-probe-${index}.example`;
    const token = kind === "unsigned" ? null : kind === "malformed" ? "not-a-token" : kind === "forged" ? `${Math.floor(Date.now() / 1000)}.${crypto.randomUUID()}.${"a".repeat(64)}` : kind === "expired" ? await createDomainProbe(host, Date.now() - 180_000) : await createDomainProbe("different-probe.example");
    const probes: boolean[] = []; lookupFixture(t, host, probes);
    const response = await rewriteChurchSite(request(host, token));
    assert.equal(response?.status, 404); assert.equal(response?.headers.get("x-faithform-domain-proof"), null); assert.deepEqual(probes, [false]);
  }
});

test("a signed probe cannot select another church or bypass reserved application routes", async t => {
  configure(t); const host = "scoped-probe.example"; lookupFixture(t, host); const token = await createDomainProbe(host); assert.ok(token);
  const response = await rewriteChurchSite(request(host, token, "/about?site=foreign"));
  assert.equal(new URL(response!.headers.get("x-middleware-rewrite")!).pathname, "/sites/grace/about");
  assert.equal(await validDomainProof(host, "grace", token, response!.headers.get("x-faithform-domain-proof")), true);
  assert.equal((await rewriteChurchSite(request(host, token, "/sites/foreign")))?.status, 404);
  assert.equal(await rewriteChurchSite(request(host, token, "/api/sites/contact?site=foreign")), null);
  assert.equal(await rewriteChurchSite(request("app.probe.example", await createDomainProbe("app.probe.example"))), null);
});

// Execute the actual site page with a private draft bundle. The middleware's
// proof only confirms hostname routing; it is never a draft-preview authority.
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
type RouteProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };
type PageRoute = { default: (props: RouteProps) => Promise<unknown>; generateMetadata: (props: RouteProps) => Promise<Record<string, unknown>> };
async function draftPage(token: string): Promise<PageRoute> {
  const { build } = tsxRequire("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };
  const entry = fileURLToPath(new URL("../../app/sites/[slug]/[[...path]]/page.tsx", import.meta.url));
  type Build = { onResolve(options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined): void; onLoad(options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { loader: string; contents: string }): void };
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, packages: "external", platform: "node", format: "cjs", target: "node20", jsx: "automatic", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)), plugins: [{ name: "probe-draft-access", setup(builder: Build) {
    builder.onResolve({ filter: /^(?:@\/lib\/(?:sites\/queries|auth\/church|features\/access)|next\/headers)$/ }, args => args.importer === entry ? { path: args.path, namespace: "probe-draft" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "probe-draft" }, args => ({ loader: "js", contents: args.path === "next/headers"
      ? `export async function headers(){return new Headers({host:"draft-proof.example","x-faithform-domain-probe":${JSON.stringify(token)}})}`
      : args.path.endsWith("sites/queries")
        ? 'export async function getSiteBundle(){return {churchId:"test-church",settings:{layoutMode:"landing",isPublished:false},page:{status:"draft",path:"/"}}};export async function getSiteNavigationPages(){return []}'
        : args.path.endsWith("auth/church")
          ? 'export async function getChurchAuth(){return null}'
          : 'export function canAccessFeature(){return false};export async function getFeatureAccess(){return {allowed:[]}};export async function isChurchFeatureEnabled(){return true}' }));
  } }] });
  const compiledModule = { exports: {} as PageRoute }; new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, compiledModule, compiledModule.exports); return compiledModule.exports;
}

test("a signed pending-domain rewrite still refuses anonymous draft pages and metadata", async t => {
  configure(t); const host = "draft-proof.example"; lookupFixture(t, host); const token = await createDomainProbe(host); assert.ok(token);
  assert.ok((await rewriteChurchSite(request(host, token)))?.headers.get("x-faithform-domain-proof"));
  const route = await draftPage(token);
  for (const preview of [undefined, "1"]) {
    const props: RouteProps = { params: Promise.resolve({ slug: "grace" }), searchParams: Promise.resolve({ preview }) };
    await assert.rejects(route.default(props), error => error instanceof Error && "digest" in error && error.digest === "NEXT_HTTP_ERROR_FALLBACK;404");
    assert.deepEqual(await route.generateMetadata(props), { title: "Not found", robots: { index: false, follow: false } });
  }
});
