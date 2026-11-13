import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { canPreviewDraftSite, isPublicSitePublication } from "../../lib/sites/preview-access";
import { CODE_SITE_THEMES } from "../../lib/sites/themes";

const churchId = "d1d65673-2d45-4825-9e6e-c2d85d4583fd";
type Viewer = { churchId: string; isAdmin: boolean; featurePermissions: string[] };
type Fixture = { viewer: Viewer | null; allowed: string[]; enabled: boolean; published: boolean; homeStatus: string; aboutStatus: string; authReads: number };
const state: Fixture = { viewer: null, allowed: [], enabled: true, published: true, homeStatus: "published", aboutStatus: "draft", authReads: 0 };
Object.assign(globalThis, { __websitePreviewAccessTest: state });

test("anonymous publication requires both page and settings to be published", () => {
  assert.equal(isPublicSitePublication("published", true), true);
  assert.equal(isPublicSitePublication("published", false), false);
  assert.equal(isPublicSitePublication("published", null), false);
  assert.equal(isPublicSitePublication("draft", true), false);
});

test("draft website previews require a viewer from the same church with website access", () => {
  assert.equal(canPreviewDraftSite(churchId, null), false);
  assert.equal(canPreviewDraftSite(churchId, { churchId: "ffde855b-e97a-499f-aa75-d2fab09382b8", isAdmin: true, featurePermissions: ["website"] }), false);
  assert.equal(canPreviewDraftSite(churchId, { churchId, isAdmin: false, featurePermissions: ["people"] }), false);
  assert.equal(canPreviewDraftSite(churchId, { churchId, isAdmin: false, featurePermissions: ["website"] }), true);
  assert.equal(canPreviewDraftSite(churchId, { churchId, isAdmin: true, featurePermissions: [] }), true);
});

type Props = { params: Promise<{ slug: string; path?: string[] }>; searchParams: Promise<{ preview?: string }> };
type Rendered = { props: { page: { sections: { type: string; content: Record<string, unknown> }[] } } };
type Routes = {
  dynamic: string;
  default: (props: Props) => Promise<Rendered>;
  generateMetadata: (props: Props) => Promise<Record<string, unknown>>;
};
type Contact = { POST: (request: NextRequest) => Promise<Response> };
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
type PluginBuild = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }) => void;
};
const { build } = tsxRequire("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };
let modules: Promise<{ page: Routes; contact: Contact }> | null = null;
function routes() {
  modules ??= (async () => {
    const featurePath = fileURLToPath(new URL("../../lib/features/access.ts", import.meta.url));
    async function compile<T>(relative: string): Promise<T> {
      const entry = fileURLToPath(new URL(relative, import.meta.url));
      const built = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", target: "node20", jsx: "automatic", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)), plugins: [{ name: "website-preview-providers", setup(builder: PluginBuild) {
        builder.onResolve({ filter: /^(?:@\/lib\/(?:auth\/church|features\/access)|next\/headers)$/ }, args => args.importer === entry ? { path: args.path, namespace: "preview-test" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "preview-test" }, args => ({ loader: "js", resolveDir: fileURLToPath(new URL("../../", import.meta.url)), contents: args.path === "next/headers"
          ? 'export async function headers(){return new Headers({host:"app.faithform.test"})}'
          : args.path.endsWith("auth/church")
            ? 'export async function getChurchAuth(){globalThis.__websitePreviewAccessTest.authReads++;return globalThis.__websitePreviewAccessTest.viewer}'
            : `export {canAccessFeature} from ${JSON.stringify(featurePath)}; export async function getFeatureAccess(){return {allowed:globalThis.__websitePreviewAccessTest.allowed}}; export async function isChurchFeatureEnabled(){return globalThis.__websitePreviewAccessTest.enabled}; export async function isChurchFeatureEmailEnabled(){return false}` }));
      } }] });
      const compiledModule = { exports: {} as T };
      new Function("require", "module", "exports", built.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
      return compiledModule.exports;
    }
    return { page: await compile<Routes>("../../app/sites/[slug]/[[...path]]/page.tsx"), contact: await compile<Contact>("../../app/api/sites/contact/route.ts") };
  })();
  return modules;
}

function configure(t: TestContext) {
  state.viewer = null; state.allowed = []; state.enabled = true; state.published = true; state.homeStatus = "published"; state.aboutStatus = "draft"; state.authReads = 0;
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://preview-access.example.test", SUPABASE_SECRET_KEY: "safe-test-key", NEXT_PUBLIC_SITE_URL: "https://app.faithform.test" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const delivered: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "preview-access.example.test");
    const page = (path: string) => ({ id: path === "/" ? "home" : "about", path, title: path === "/" ? "Private home title" : "Related draft title", meta_description: "Private metadata description", status: path === "/" ? state.homeStatus : state.aboutStatus });
    switch (url.pathname.split("/").pop()) {
      case "churches": return Response.json({ id: churchId, slug: "grace", name: "Private church name", description: "Private church description", email: "office@example.test" });
      case "site_settings": return Response.json({ theme_key: "grace", layout_mode: "website", is_published: state.published, contact_email: "office@example.test" });
      case "site_pages": {
        if (url.searchParams.get("select")?.includes("site_sections")) return Response.json(["/", "/about"].map(path => ({ ...page(path), site_sections: [{ type: path === "/" ? "hero" : "about_text", is_visible: true, church_id: churchId }] })));
        const path = url.searchParams.get("path")?.slice(3) ?? "/";
        return Response.json(["/", "/about"].includes(path) ? page(path) : null);
      }
      case "site_sections": return Response.json(url.searchParams.get("page_id") === "eq.about"
        ? [{ id: "about-body", type: "about_text", is_visible: true, sort_order: 0, props: { headline: { lead: "Related draft content" }, body: ["Confidential related draft"] } }]
        : [{ id: "hero", type: "hero", is_visible: true, sort_order: 0, props: { headline: { lead: "Home content" } } }]);
      case "site_themes": return Response.json({ key: "grace", name: "Grace", tokens: CODE_SITE_THEMES.grace.tokens, section_defaults: CODE_SITE_THEMES.grace.sectionDefaults });
      case "consume_api_rate_limit": return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
      case "site_contact_submissions":
        assert.equal(init?.method, "POST");
        delivered.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ id: "test-submission" });
      default: return Response.json([]);
    }
  });
  return delivered;
}
function props(preview?: string): Props { return { params: Promise.resolve({ slug: "grace" }), searchParams: Promise.resolve({ preview }) }; }
function notFound(error: unknown) { return error instanceof Error && "digest" in error && error.digest === "NEXT_HTTP_ERROR_FALLBACK;404"; }

test("actual public page and metadata allow anonymous published content without related drafts", async t => {
  configure(t);
  const { page } = await routes();
  assert.equal(page.dynamic, "force-dynamic");
  const result = await page.default(props());
  assert.ok(result.props.page.sections.some(section => section.type === "hero"));
  assert.equal(result.props.page.sections.some(section => section.type === "about_text"), false);
  assert.equal(state.authReads, 0);
  assert.equal((await page.generateMetadata(props())).title, "Private home title");
});

test("anonymous preview queries never reveal public-site related drafts or private metadata", async t => {
  configure(t);
  const { page } = await routes();
  await assert.rejects(page.default(props("1")), notFound);
  assert.deepEqual(await page.generateMetadata(props("1")), { title: "Not found", robots: { index: false, follow: false } });
  state.published = false; state.homeStatus = "draft";
  await assert.rejects(page.default(props()), notFound);
  assert.deepEqual(await page.generateMetadata(props()), { title: "Not found", robots: { index: false, follow: false } });
});

test("own authorized draft preview includes related drafts while foreign, ungranted and disabled viewers are denied", async t => {
  configure(t);
  const { page } = await routes();
  state.published = false; state.homeStatus = "draft";
  state.viewer = { churchId, isAdmin: false, featurePermissions: ["website"] }; state.allowed = ["website"];
  const result = await page.default(props("1"));
  assert.ok(result.props.page.sections.some(section => section.type === "about_text"));
  assert.match(JSON.stringify(result.props.page.sections), /Confidential related draft/);
  const metadata = await page.generateMetadata(props("1"));
  assert.equal(metadata.title, "Private home title");
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  for (const viewer of [
    { churchId: "other", isAdmin: true, featurePermissions: ["website"] },
    { churchId, isAdmin: false, featurePermissions: ["people"] },
  ]) {
    state.viewer = viewer;
    await assert.rejects(page.default(props("1")), notFound);
    assert.equal((await page.generateMetadata(props("1"))).title, "Not found");
  }
  state.viewer = { churchId, isAdmin: false, featurePermissions: ["website"] }; state.allowed = [];
  await assert.rejects(page.default(props("1")), notFound);
  state.allowed = ["website"]; state.enabled = false;
  await assert.rejects(page.default(props("1")), notFound);
  assert.equal((await page.generateMetadata(props("1"))).title, "Not found");
});

test("actual draft contact submissions require authorized own-church staff and retain the correct inbox", async t => {
  const delivered = configure(t);
  state.published = false; state.homeStatus = "draft";
  const { contact } = await routes();
  const send = () => contact.POST(new NextRequest("https://app.faithform.test/api/sites/contact?site=grace", {
    method: "POST", headers: { host: "app.faithform.test", "content-type": "application/json" },
    body: JSON.stringify({ name: "Preview test visitor", email: "visitor@example.test", message: "Safe local preview test" }),
  }));
  assert.equal((await send()).status, 404);
  state.viewer = { churchId: "other", isAdmin: true, featurePermissions: ["website"] };
  assert.equal((await send()).status, 404);
  state.viewer = { churchId, isAdmin: false, featurePermissions: ["people"] };
  assert.equal((await send()).status, 404);
  assert.equal(delivered.length, 0);
  state.viewer = { churchId, isAdmin: false, featurePermissions: ["website"] };
  assert.equal((await send()).status, 200);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].church_id, churchId);
  state.enabled = false;
  assert.equal((await send()).status, 404);
  assert.equal(delivered.length, 1);
});
