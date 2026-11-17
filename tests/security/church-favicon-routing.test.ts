import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import ts from "typescript";
import sharp from "sharp";
import { rewriteChurchSite } from "@/lib/sites/tenant";
import { CHURCH_ICON_ALIASES, CHURCH_ICON_SIZES } from "@/lib/sites/icon-paths";
import { churchSiteIconRevision } from "@/lib/sites/icons";

function compile(path: string, mocks: Record<string, unknown>) {
  const localRequire = createRequire(resolve(path));
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const result = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)((id: string) => mocks[id] ?? localRequire(id), result, result.exports);
  return result.exports;
}

function iconRoutes(mocks: Record<string, unknown>) {
  const renderer = compile("lib/sites/icon-response.ts", mocks);
  const dependencies = { "@/lib/sites/icon-response": renderer };
  return {
    legacy: compile("app/sites/[slug]/favicon.ico/route.ts", dependencies) as {
      dynamic: string; GET: (request: Request, context: { params: Promise<{ slug: string }> }) => Promise<Response>;
    },
    versioned: compile("app/sites/[slug]/site-icons/[revision]/[asset]/route.ts", dependencies) as {
      dynamic: string; GET: (request: Request, context: { params: Promise<{ slug: string; revision: string; asset: string }> }) => Promise<Response>;
    },
  };
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
  const { getMiddlewareMatchers } = createRequire(resolve("package.json"))("next/dist/build/analysis/get-page-static-info");
  const matchers = getMiddlewareMatchers(routing.config.matcher, {}) as { regexp: string }[];
  const matches = (path: string) => matchers.some(({ regexp }) => new RegExp(regexp).test(path));
  assert.ok(routing.config.matcher.includes("/favicon.ico"));
  assert.ok(routing.config.matcher.includes("/site-icons/:path*"));
  for (const slug of ["grace", "somerset"]) {
    const host = `${slug}.faithform.test`;
    for (const [path, asset] of Object.entries(CHURCH_ICON_ALIASES)) {
      assert.ok(routing.config.matcher.includes(path));
      assert.ok(matches(path), `Next.js must run middleware for ${path}`);
      const response = await routing.middleware(new NextRequest(`https://${host}${path}?site=foreign`, { headers: { host } }));
      const rewritten = new URL(response.headers.get("x-middleware-rewrite")!);
      assert.equal(rewritten.pathname, `/sites/${slug}/favicon.ico`);
      assert.equal(rewritten.searchParams.get("size"), String(CHURCH_ICON_SIZES[asset]));
    }
    const path = "/site-icons/1234567890abcdef1234/icon-32.png";
    assert.ok(matches(path), "Next.js must run middleware for versioned PNGs");
    const response = await routing.middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
    assert.equal(new URL(response.headers.get("x-middleware-rewrite")!).pathname, `/sites/${slug}${path}`);
  }
  const host = "app.favicon.test";
  for (const path of Object.keys(CHURCH_ICON_ALIASES)) {
    const platform = await routing.middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
    assert.equal(platform.headers.get("x-middleware-next"), "1");
    assert.equal(platform.headers.get("x-middleware-rewrite"), null);
  }
});

test("uploaded logos are served as fresh same-origin PNGs without fetching arbitrary URLs", async t => {
  const before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://favicon-storage.example.test";
  t.after(() => { if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = before; });
  let logo = "https://favicon-storage.example.test/storage/v1/object/public/church-covers/grace/site/logo.jpg";
  let color = "red";
  let downloads = 0;
  const { legacy: route, versioned } = iconRoutes({
    "@/lib/features/access": { isChurchFeatureEnabled: async () => true },
    "@/lib/sites/queries": { getSiteBundle: async () => ({ churchId: "grace", profile: { name: "Grace Community", logoUrl: logo }, settings: { isPublished: true }, page: { status: "published" } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ storage: { from: (bucket: string) => ({ download: async (path: string) => {
      assert.ok(["church-covers", "branding-images", "church-logos"].includes(bucket));
      assert.ok(path.startsWith("grace/"));
      downloads++;
      const bytes = await sharp({ create: { width: 16, height: 8, channels: 3, background: color } }).jpeg().toBuffer();
      return { data: new Blob([new Uint8Array(bytes)]), error: null };
    } }) } }) },
  });
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
  const revision = () => churchSiteIconRevision({ name: "Grace Community", logoUrl: logo });
  for (const [asset, size] of Object.entries(CHURCH_ICON_SIZES)) {
    const request = new Request(`https://grace.faithform.test/site-icons/${revision()}/${asset}`);
    const response = await versioned.GET(request, { params: Promise.resolve({ slug: "grace", revision: revision(), asset }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("location"), null);
    assert.match(response.headers.get("cache-control")!, /max-age=31536000, immutable/);
    const actual = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(actual.width, size);
    assert.equal(actual.height, size);
  }
  const validDownloads = downloads;
  for (const [asset, version] of [["icon-32.png", "invalid"], ["arbitrary.png", revision()], ["icon-32.png", "0".repeat(20)]]) {
    const response = await versioned.GET(new Request("https://grace.faithform.test/"), { params: Promise.resolve({ slug: "grace", revision: version, asset }) });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(downloads, validDownloads);
  }
  color = "blue";
  logo = logo.replace("logo.jpg", "replacement.jpg");
  assert.notDeepEqual(Buffer.from(await (await get()).arrayBuffer()), original);
  assert.equal(downloads, validDownloads + 1);
  const afterReplacement = downloads;
  for (const unsafe of [
    "http://127.0.0.1/secret", "https://foreign.example.test/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/church-covers/other/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/private-files/grace/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/church-covers/grace/%252e%252e/other/logo.png",
    "https://favicon-storage.example.test/storage/v1/object/public/church-covers/grace/%2e%2e%2fother/logo.png",
  ]) {
    logo = unsafe;
    await get();
    assert.equal(downloads, afterReplacement);
  }
});

test("the actual favicon route returns only the published church logo and refuses drafts or disabled sites", async () => {
  const state = { published: true, enabled: true, logo: "https://images.example.test/grace.png" as string | null };
  const { legacy: route, versioned } = iconRoutes({
    "@/lib/features/access": { isChurchFeatureEnabled: async () => state.enabled },
    "@/lib/sites/queries": { getSiteBundle: async (slug: string) => ({ churchId: slug, profile: { name: "Grace Community", logoUrl: state.logo }, settings: { isPublished: state.published }, page: { status: "published" } }) },
  });
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
  state.published = false;
  const revision = churchSiteIconRevision({ name: "Grace Community", logoUrl: state.logo });
  const hidden = await versioned.GET(new Request("https://grace.faithform.test/"), { params: Promise.resolve({ slug: "grace", revision, asset: "apple-180.png" }) });
  assert.equal(hidden.status, 404);
});

test("temporary storage failures never freeze the initials fallback in an immutable cache", async t => {
  const before = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://favicon-storage.example.test";
  t.after(() => { if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = before; });
  const profile = { name: "Grace Community", logoUrl: "https://favicon-storage.example.test/storage/v1/object/public/branding-images/grace/church/logo.png" };
  const { versioned } = iconRoutes({
    "@/lib/features/access": { isChurchFeatureEnabled: async () => true },
    "@/lib/sites/queries": { getSiteBundle: async () => ({ churchId: "grace", profile, settings: { isPublished: true }, page: { status: "published" } }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ storage: { from: () => ({ download: async () => ({ data: null, error: new Error("temporary outage") }) }) } }) },
  });
  const response = await versioned.GET(new Request("https://grace.faithform.test/"), { params: Promise.resolve({ slug: "grace", revision: churchSiteIconRevision(profile), asset: "apple-180.png" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const actual = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(actual.width, 180);
  assert.equal(actual.height, 180);
});
