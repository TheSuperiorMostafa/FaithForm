import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { churchSlugForHost, isPlatformSiteHost, rewriteChurchSite, siteHostname } from "@/lib/sites/tenant";

function configure(t: TestContext) {
  const values = {
    NEXT_PUBLIC_SITE_URL: "https://app.faithform.test",
    NEXT_PUBLIC_SITE_ROOT_HOST: "faithform.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
    SUPABASE_SECRET_KEY: "test-secret",
    VERCEL_URL: "faithform-deployment.vercel.app",
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
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
  for (const host of ["app.faithform.test", "faithform.test", "www.faithform.test", "localhost:3000", "faithform-deployment.vercel.app"]) {
    assert.equal(isPlatformSiteHost(host), true, host);
    assert.equal(await rewriteChurchSite(request(host, "/dashboard/website")), null, host);
  }
  const response = await rewriteChurchSite(request("grace.faithform.test", "/staff?from=nav"));
  assert.equal(new URL(response!.headers.get("x-middleware-rewrite")!).pathname, "/sites/grace/staff");
  assert.equal(new URL(response!.headers.get("x-middleware-rewrite")!).search, "?from=nav");
  assert.equal(fetch.mock.callCount(), 0);
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
