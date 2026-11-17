import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import ts from "typescript";
import { rewriteChurchSite } from "@/lib/sites/tenant";

function compile(path: string, mocks: Record<string, unknown>) {
  const localRequire = createRequire(resolve(path));
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const result = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)((id: string) => mocks[id] ?? localRequire(id), result, result.exports);
  return result.exports;
}

function setup(t: TestContext) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SITE_URL: "https://app.favicon.test", NEXT_PUBLIC_SITE_ROOT_HOST: "faithform.test" })) {
    const before = process.env[key]; process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
}

test("browser fallback icons resolve per church while the platform keeps its own icon", async t => {
  setup(t);
  const routing = compile("middleware.ts", {
    "@/lib/sites/tenant": { rewriteChurchSite },
    "@/lib/supabase/middleware": { updateSession() { assert.fail("favicons must not enter staff authentication"); } },
  }) as { middleware: (request: NextRequest) => Promise<Response>; config: { matcher: string[] } };
  assert.ok(routing.config.matcher.includes("/favicon.ico"));
  for (const slug of ["grace", "somerset"]) {
    const host = `${slug}.faithform.test`;
    const response = await routing.middleware(new NextRequest(`https://${host}/favicon.ico?site=foreign`, { headers: { host } }));
    assert.equal(new URL(response.headers.get("x-middleware-rewrite")!).pathname, `/sites/${slug}/favicon.ico`);
  }
  const host = "app.favicon.test";
  const platform = await routing.middleware(new NextRequest(`https://${host}/favicon.ico`, { headers: { host } }));
  assert.equal(platform.headers.get("x-middleware-next"), "1");
  assert.equal(platform.headers.get("x-middleware-rewrite"), null);
});

test("the actual favicon route returns only the published church logo and refuses drafts or disabled sites", async () => {
  const state = { published: true, enabled: true, logo: "https://images.example.test/grace.png" as string | null };
  const route = compile("app/sites/[slug]/favicon.ico/route.ts", {
    "@/lib/features/access": { isChurchFeatureEnabled: async () => state.enabled },
    "@/lib/sites/queries": { getSiteBundle: async (slug: string) => ({ churchId: slug, profile: { name: "Grace Community", logoUrl: state.logo }, settings: { isPublished: state.published }, page: { status: "published" } }) },
  }) as { GET: (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response> };
  const get = () => route.GET(new Request("https://grace.faithform.test/favicon.ico?url=https://foreign.example"), { params: Promise.resolve({ slug: "grace" }) });
  const image = await get();
  assert.equal(image.status, 302);
  assert.equal(image.headers.get("location"), state.logo);
  assert.equal(image.headers.get("cache-control"), "no-store");
  state.published = false; assert.equal((await get()).status, 404);
  state.published = true; state.enabled = false; assert.equal((await get()).status, 404);
  state.enabled = true; state.logo = null;
  const initials = await get();
  assert.equal(initials.status, 200);
  assert.equal(initials.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await initials.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
