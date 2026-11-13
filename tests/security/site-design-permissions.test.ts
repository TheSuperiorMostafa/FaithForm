import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type Result = { ok: true } | { ok: false; error: string };
type ActionModule = { saveDesign: (input: unknown) => Promise<Result> };
type State = {
  auth: { churchId: string; userId: string; isAdmin: boolean } | null;
  featureError: string | null; platform: boolean;
  features: string[]; platformChecks: string[]; revalidated: string[];
};
const churchId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const state: State = { auth: null, featureError: null, platform: false, features: [], platformChecks: [], revalidated: [] };
Object.assign(globalThis, { __siteDesignPermissionsTest: state });
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
type PluginBuild = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }) => void;
};
const { build } = tsxRequire("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };
let compiled: Promise<ActionModule> | null = null;
function actions(): Promise<ActionModule> {
  compiled ??= (async () => {
    const path = fileURLToPath(new URL("../../app/dashboard/website/actions.ts", import.meta.url));
    const built = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", target: "node20", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)), plugins: [{ name: "site-design-auth", setup(builder: PluginBuild) {
      builder.onResolve({ filter: /^(?:@\/lib\/(?:auth\/church|auth\/superadmin|features\/guard)|next\/cache)$/ }, args => args.importer === path ? { path: args.path, namespace: "design-test-auth" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "design-test-auth" }, args => ({ loader: "js", contents: args.path === "next/cache"
        ? 'export function revalidatePath(path){globalThis.__siteDesignPermissionsTest.revalidated.push(path)}'
        : args.path.endsWith("auth/church")
          ? 'export async function requireChurchAuth(){const value=globalThis.__siteDesignPermissionsTest.auth;if(!value)throw new Error("signed out");return value;}'
          : args.path.endsWith("auth/superadmin")
            ? 'export async function isPlatformAdminUserId(id){globalThis.__siteDesignPermissionsTest.platformChecks.push(id);return globalThis.__siteDesignPermissionsTest.platform;}'
            : 'export async function featureActionError(key){globalThis.__siteDesignPermissionsTest.features.push(key);return globalThis.__siteDesignPermissionsTest.featureError;}' }));
    } }] });
    const compiledModule = { exports: {} as ActionModule };
    new Function("require", "module", "exports", built.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  })();
  return compiled;
}

function configure(t: TestContext) {
  state.auth = { churchId, userId, isAdmin: true };
  state.featureError = null; state.platform = false;
  state.features = []; state.platformChecks = []; state.revalidated = [];
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://design-permissions.example.test", SUPABASE_SECRET_KEY: "safe-test-key" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

function database(t: TestContext, initialCss: string | null) {
  const saved = { customCss: initialCss, readFails: false, writes: [] as Record<string, unknown>[], cssReads: 0 };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "design-permissions.example.test");
    if (url.pathname.endsWith("/site_themes")) {
      assert.equal(url.searchParams.get("is_active"), "eq.true");
      return Response.json({ key: "wood" });
    }
    assert.ok(url.pathname.endsWith("/site_settings"));
    if (init?.method === "POST") {
      assert.equal(url.searchParams.get("on_conflict"), "church_id");
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(payload.church_id, churchId, "only the authenticated church may be written");
      saved.writes.push(payload);
      if (Object.hasOwn(payload, "custom_css")) saved.customCss = payload.custom_css as string | null;
      return Response.json(null);
    }
    assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
    assert.equal(url.searchParams.get("select"), "custom_css");
    saved.cssReads++;
    return saved.readFails
      ? Response.json({ code: "XX000", message: "Private SQL implementation detail" }, { status: 503 })
      : Response.json({ custom_css: saved.customCss });
  });
  return saved;
}
const design = { themeKey: "wood", brandTokens: { "--site-accent": "#C8961E" } };

test("actual design action denies signed-out, feature-blocked and non-admin callers before database access", async t => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected database access"); });
  const { saveDesign } = await actions();
  state.auth = null;
  assert.equal((await saveDesign(design)).ok, false);
  assert.deepEqual(state.features, []);
  state.auth = { churchId, userId, isAdmin: true }; state.featureError = "Website access is disabled.";
  assert.equal((await saveDesign(design)).ok, false);
  state.featureError = null; state.auth.isAdmin = false;
  assert.equal((await saveDesign(design)).ok, false);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(state.platformChecks, []);
});

test("ordinary theme/color saves omit privileged CSS and preserve the stored value, including unchanged submissions", async t => {
  configure(t);
  const current = ".site-hero{padding-top:42px}";
  const db = database(t, current);
  const { saveDesign } = await actions();
  assert.equal((await saveDesign({ ...design, churchId: "foreign", userId: "forged-platform-user", platformAdmin: true })).ok, true);
  assert.equal(db.customCss, current);
  assert.equal(db.cssReads, 0);
  assert.deepEqual(state.platformChecks, []);
  assert.deepEqual(db.writes[0], { church_id: churchId, theme_key: "wood", brand_tokens: design.brandTokens });
  assert.equal((await saveDesign({ ...design, customCss: current })).ok, true);
  assert.equal(db.customCss, current);
  assert.equal(Object.hasOwn(db.writes[1], "custom_css"), false);
  assert.deepEqual(state.platformChecks, [userId]);
  assert.ok(state.revalidated.includes("/sites"));
});

test("ordinary church admins cannot introduce, replace or clear privileged CSS", async t => {
  configure(t);
  const db = database(t, null);
  const { saveDesign } = await actions();
  for (const [current, requested] of [[null, ".site-hero{color:red}"], [".site-hero{color:blue}", ".site-hero{color:red}"], [".site-hero{color:blue}", ""]] as const) {
    db.customCss = current;
    const outcome = await saveDesign({ ...design, customCss: requested });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.error, /platform admins/);
    assert.equal(db.customCss, current);
  }
  assert.equal(db.writes.length, 0);
  assert.deepEqual(state.platformChecks, [userId, userId, userId]);
  assert.deepEqual(state.revalidated, []);
});

test("platform-authorized design changes can replace and explicitly clear CSS, while omission preserves it", async t => {
  configure(t); state.platform = true;
  const db = database(t, ".site-hero{color:blue}");
  const { saveDesign } = await actions();
  assert.equal((await saveDesign({ ...design, customCss: ".site-hero{color:red}" })).ok, true);
  assert.equal(db.customCss, ".site-hero{color:red}");
  assert.equal((await saveDesign({ ...design, customCss: "" })).ok, true);
  assert.equal(db.customCss, null);
  assert.equal(db.writes[1].custom_css, null);
  db.customCss = ".site-hero{color:green}";
  assert.equal((await saveDesign(design)).ok, true);
  assert.equal(db.customCss, ".site-hero{color:green}");
  assert.equal(Object.hasOwn(db.writes[2], "custom_css"), false);
  assert.deepEqual(state.platformChecks, [userId, userId]);
});

test("a failed privileged CSS read performs no write, returns safe feedback and succeeds after retry", async t => {
  configure(t);
  const current = ".site-hero{padding-top:42px}";
  const db = database(t, current); db.readFails = true;
  t.mock.method(console, "error", () => {});
  const { saveDesign } = await actions();
  const result = await saveDesign({ ...design, customCss: current });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /could not be saved/);
    assert.doesNotMatch(result.error, /Private SQL|XX000/);
  }
  assert.equal(db.writes.length, 0);
  assert.equal(db.customCss, current);
  assert.deepEqual(state.revalidated, []);
  db.readFails = false;
  assert.equal((await saveDesign({ ...design, customCss: current })).ok, true);
  assert.equal(db.writes.length, 1);
  assert.equal(Object.hasOwn(db.writes[0], "custom_css"), false);
});
