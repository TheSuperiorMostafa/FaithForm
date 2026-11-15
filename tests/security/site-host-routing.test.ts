import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { churchSlugForHost, isPlatformSiteHost, rewriteChurchSite, siteHostname } from "@/lib/sites/tenant";

function configure(t: TestContext, overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    NEXT_PUBLIC_SITE_URL: "https://app.faithform.test",
    SITE_URL: undefined,
    INVITE_SITE_URL: undefined,
    NEXT_PUBLIC_SITE_ROOT_HOST: "faithform.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
    SUPABASE_SECRET_KEY: "test-secret",
    VERCEL_URL: "faithform-deployment.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "faithform-project.vercel.app",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

function request(host: string, path = "/") {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

test("platform/deployment hosts keep app routes and church hosts keep nested page routing", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected domain lookup"); });
  assert.equal(siteHostname("GRACE.FAITHFORM.TEST.:443"), "grace.faithform.test");
  for (const host of ["app.faithform.test", "faithform.io", "faithform.test", "www.faithform.test", "localhost:3000", "faithform-deployment.vercel.app", "faithform-project.vercel.app"]) {
    assert.equal(isPlatformSiteHost(host), true, host);
    assert.equal(await rewriteChurchSite(request(host, "/dashboard/website")), null, host);
  }
  const response = await rewriteChurchSite(request("grace.faithform.test", "/staff?from=nav"));
  assert.equal(new URL(response!.headers.get("x-middleware-rewrite")!).pathname, "/sites/grace/staff");
  assert.equal(new URL(response!.headers.get("x-middleware-rewrite")!).search, "?from=nav");
  assert.equal(fetch.mock.callCount(), 0);
});

for (const [name, siteUrl] of [["unset", undefined], ["blank", "   "]] as const) {
  test(`Vercel's chosen church domain remains tenant-routed when the application URL is ${name}`, async (t) => {
    const hostname = `lgcnaz-${name}.example`;
    configure(t, {
      NEXT_PUBLIC_SITE_URL: siteUrl,
      VERCEL_PROJECT_PRODUCTION_URL: hostname,
    });
    const fetch = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/site_domains");
      assert.equal(url.searchParams.get("hostname"), `eq.${hostname}`);
      assert.equal(url.searchParams.get("status"), "eq.live");
      assert.equal(url.searchParams.get("verified_at"), "not.is.null");
      return Response.json([{ churches: { slug: "grace-community-church" } }]);
    });

    assert.equal(isPlatformSiteHost(hostname), false);
    assert.equal(await churchSlugForHost(hostname), "grace-community-church");
    const response = await rewriteChurchSite(request(hostname, "/staff?from=nav"));
    const destination = new URL(response!.headers.get("x-middleware-rewrite")!);
    assert.equal(destination.pathname, "/sites/grace-community-church/staff");
    assert.equal(destination.search, "?from=nav");
    for (const appHost of ["faithform.io", "localhost:3000", "faithform-deployment.vercel.app"]) {
      assert.equal(isPlatformSiteHost(appHost), true, appHost);
      assert.equal(await rewriteChurchSite(request(appHost, "/dashboard/website")), null);
    }
    assert.equal(fetch.mock.callCount(), 1, "only the church domain requires a mapping lookup");
  });
}

test("Vercel custom hostnames do not override an explicitly configured application host", (t) => {
  configure(t, {
    VERCEL_PROJECT_PRODUCTION_URL: "lgcnaz-explicit.example",
    VERCEL_URL: "custom-deployment.example",
  });
  assert.equal(isPlatformSiteHost("app.faithform.test"), true);
  assert.equal(isPlatformSiteHost("lgcnaz-explicit.example"), false);
  assert.equal(isPlatformSiteHost("custom-deployment.example"), false);
  assert.equal(isPlatformSiteHost("faithform.vercel.app.evil.example"), false);
});

test("custom domains resolve only live verified mappings and unknown hosts never fall through to the app", async (t) => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/rest/v1/site_domains");
    assert.equal(url.searchParams.get("status"), "eq.live");
    assert.equal(url.searchParams.get("verified_at"), "not.is.null");
    return Response.json(url.searchParams.get("hostname") === "eq.verified-church.example" ? [{ churches: { slug: "grace" } }] : []);
  });
  assert.equal(await churchSlugForHost("verified-church.example"), "grace");
  const response = await rewriteChurchSite(request("verified-church.example", "/visit"));
  assert.equal(new URL(response!.headers.get("x-middleware-rewrite")!).pathname, "/sites/grace/visit");
  for (const host of ["pending-church.example", "unknown.example"]) {
    assert.equal(await churchSlugForHost(host), null);
    assert.equal((await rewriteChurchSite(request(host, "/login")))?.status, 404);
  }
  assert.equal((await rewriteChurchSite(request("grace.faithform.test", "/sites/other/staff")))?.status, 404);
  assert.equal((await rewriteChurchSite(request("verified-church.example", "/sites/other")))?.status, 404);
});

test("church domains still expose the contact endpoint and Next assets without rewriting", async (t) => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected lookup"); });
  assert.equal(await rewriteChurchSite(request("grace.faithform.test", "/api/sites/contact?site=other")), null);
  assert.equal(await rewriteChurchSite(request("grace.faithform.test", "/_next/static/app.js")), null);
  assert.equal(fetch.mock.callCount(), 0);
});
