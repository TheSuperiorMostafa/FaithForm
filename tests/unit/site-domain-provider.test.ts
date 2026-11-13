import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { getDomainProvider } from "@/lib/sites/domains";

function provider(t: TestContext) {
  for (const [key, value] of Object.entries({ VERCEL_API_TOKEN: "test-token", VERCEL_PROJECT_ID: "prj_test", VERCEL_TEAM_ID: "team_test" })) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  return getDomainProvider();
}

test("domain registration retries confirm membership in our project rather than accepting arbitrary conflicts", async (t) => {
  const domains = provider(t);
  let ownProject = false;
  let conflict = 409;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("teamId"), "team_test");
    if (init?.method === "POST") {
      assert.equal(url.pathname, "/v10/projects/prj_test/domains");
      return Response.json({ error: { message: "Domain already exists" } }, { status: conflict });
    }
    if (url.pathname.startsWith("/v6/domains/")) return Response.json({ misconfigured: false });
    assert.equal(url.pathname, "/v9/projects/prj_test/domains/church.example");
    return ownProject ? Response.json({ name: "church.example", verified: true }) : Response.json({ error: { message: "Not on this project" } }, { status: 404 });
  });
  assert.equal((await domains.register("church.example")).ok, false);
  ownProject = true;
  assert.deepEqual(await domains.register("church.example"), { ok: true, providerDomainId: "church.example", serving: true });
  conflict = 400;
  assert.equal((await domains.register("church.example")).ok, true, "documented existing-domain 400 should be idempotent too");
});

test("unverified domains cannot appear live even when their DNS already points at Vercel", async (t) => {
  const domains = provider(t);
  let verified = false;
  let configReads = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/v6/domains/")) { configReads++; return Response.json({ misconfigured: false }); }
    return Response.json({ name: "church.example", verified });
  });
  assert.deepEqual(await domains.register("church.example"), { ok: true, providerDomainId: "church.example", serving: false });
  assert.deepEqual(await domains.status("church.example"), { ok: true, providerDomainId: "church.example", serving: false });
  assert.equal(configReads, 0);
  verified = true;
  assert.equal((await domains.status("church.example") as { serving: boolean }).serving, true);
});

test("provider network failures return a recoverable result instead of crashing domain actions", async (t) => {
  const domains = provider(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  assert.equal((await domains.register("church.example")).ok, false);
  assert.equal((await domains.status("church.example")).ok, false);
  assert.equal((await domains.remove("church.example")).ok, false);
});
