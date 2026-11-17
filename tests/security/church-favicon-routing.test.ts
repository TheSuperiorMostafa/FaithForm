import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import ts from "typescript";
import sharp from "sharp";
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

test("uploaded logos are served as fresh same-origin PNGs without fetching arbitrary URLs", async t => {
  const before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://favicon-storage.example.test";
  t.after(() => { if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = before; });
  let logo = "https://favicon-storage.example.test/storage/v1/object/public/church-covers/grace/site/logo.jpg";
  let color = "red";
  let downloads = 0;
  const route = compile("app/sites/[slug]/favicon.ico/route.ts", {
    "@/lib/features/access": { isChurchFeatureEnabled: async () => true },
    "@/lib/sites/queries": { getSiteBundle: async () => ({ churchId: "grace", profile: { name: "Grace Community", logoUrl: logo }, settings: { isPublished: true }, page: { status: "published" } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ storage: { from: (bucket: string) => ({ download: async (path: string) => {
      assert.ok(["church-covers", "branding-images", "church-logos"].includes(bucket));
      assert.ok(path.startsWith("grace/"));
      downloads++;
      const bytes = await sharp({ create: { width: 16, height: 8, channels: 3, background: color } }).jpeg().toBuffer();
      return { data: new Blob([new Uint8Array(bytes)]), error: null };
    } }) } }) },
  }) as { GET: (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response> };
  const get = () => route.GET(new Request("https://grace.faithform.test/favicon.ico?v=old&url=http://127.0.0.1/secret"), { params: Promise.resolve({ slug: "grace" }) });
  const first = await get();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/png");
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("location"), null);
  const original = Buffer.from(await first.arrayBuffer());
  const dimensions = await sharp(original).metadata();
  assert.equal(dimensions.width, 64);
  assert.equal(dimensions.height, 64);
  color = "blue";
  logo = logo.replace("logo.jpg", "replacement.jpg");
  assert.notDeepEqual(Buffer.from(await (await get()).arrayBuffer()), original);
  assert.equal(downloads, 2);
  for (const unsafe of [
    "http://127.0.0.1/secret", "https://foreign.example.test/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/church-covers/other/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/private-files/grace/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/church-covers/grace/%252e%252e/other/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/church-covers/grace/%2e%2e%2fother/logo.png",
  ]) {
    logo = unsafe;
    await get();
    assert.equal(downloads, 2);
  }
});

test("the actual favicon route returns only the published church logo and refuses drafts or disabled sites", async () => {
  const state = { published: true, enabled: true, logo: "https://images.example.test/grace.png" as string | null };
  const route = compile("app/sites/[slug]/favicon.ico/route.ts", {
    "@/lib/features/access": { isChurchFeatureEnabled: async () => state.enabled },
    "@/lib/sites/queries": { getSiteBundle: async (slug: string) => ({ churchId: slug, profile: { name: "Grace Community", logoUrl: state.logo }, settings: { isPublished: state.published }, page: { status: "published" } }) },
  }) as { dynamic: string; GET: (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response> };
  assert.equal(route.dynamic, "force-dynamic");
  const get = () => route.GET(new Request("https://grace.faithform.test/favicon.ico?url=https://foreign.example"), { params: Promise.resolve({ slug: "grace" }) });
  const image = await get();
  assert.equal(image.status, 302);
  assert.equal(image.headers.get("location"), state.logo);
  assert.equal(image.headers.get("cache-control"), "no-store");
  // Saving a replacement logo must change the next response without a build.
  state.logo = "https://images.example.test/grace-replacement.png";
  const replacement = await get();
  assert.equal(replacement.status, 302);
  assert.equal(replacement.headers.get("location"), state.logo);
  assert.equal(replacement.headers.get("cache-control"), "no-store");
  state.published = false; assert.equal((await get()).status, 404);
  state.published = true; state.enabled = false; assert.equal((await get()).status, 404);
  state.enabled = true; state.logo = null;
  const initials = await get();
  assert.equal(initials.status, 200);
  assert.equal(initials.headers.get("content-type"), "image/png");
  assert.deepEqual([...new Uint8Array(await initials.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
