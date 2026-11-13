import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { getContactSubmissions, getContactSubmissionsPage, type ContactSubmissionCursor, type ContactSubmissionPage } from "../../lib/sites/queries";

type ActionResult = ({ ok: true } & ContactSubmissionPage) | { ok: false; error: string };
type ActionModule = { loadOlderContactSubmissions: (input: unknown) => Promise<ActionResult> };
type TestState = { auth: { churchId: string; isAdmin: boolean } | null; featureError: string | null; features: string[] };
const state: TestState = { auth: null, featureError: null, features: [] };
Object.assign(globalThis, { __websiteInboxReadTest: state });

// Compile the actual server action with only its auth/feature providers mocked.
// The real Supabase query/client still makes its HTTP request into mocked fetch.
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
    const actionPath = fileURLToPath(new URL("../../app/dashboard/website/actions.ts", import.meta.url));
    const result = await build({ entryPoints: [actionPath], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", target: "node20", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)), plugins: [{ name: "mock-inbox-auth", setup(builder: PluginBuild) {
      builder.onResolve({ filter: /^@\/lib\/(auth\/church|features\/guard)$/ }, args => args.importer === actionPath ? { path: args.path, namespace: "inbox-test-auth" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "inbox-test-auth" }, args => ({ loader: "js", contents: args.path.endsWith("auth/church")
        ? 'export async function requireChurchAuth(){ const value=globalThis.__websiteInboxReadTest.auth; if(!value) throw new Error("signed out"); return value; }'
        : 'export async function featureActionError(key){ globalThis.__websiteInboxReadTest.features.push(key); return globalThis.__websiteInboxReadTest.featureError; }' }));
    } }] });
    const compiledModule = { exports: {} as ActionModule };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  })();
  return compiled;
}

const church = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-11-12T12:00:00.123456+00:00";
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const cursor: ContactSubmissionCursor = { createdAt: timestamp, id: id(200) };
function configure(t: TestContext) {
  state.auth = { churchId: church, isAdmin: false };
  state.featureError = null;
  state.features = [];
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://inbox-pagination.example.test", SUPABASE_SECRET_KEY: "test-secret" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}
function raw(value: number) {
  return { id: id(value), name: `Visitor ${value}`, email: "visitor@example.test", phone: null, message: "Safe mocked message", status: "new", emailed_at: null, created_at: timestamp };
}

test("inbox read action denies signed-out and feature-blocked callers before database HTTP", async t => {
  configure(t);
  const http = t.mock.method(globalThis, "fetch", async () => { throw new Error("No database request expected"); });
  const action = (await actions()).loadOlderContactSubmissions;
  state.auth = null;
  assert.equal((await action({ cursor })).ok, false);
  assert.deepEqual(state.features, []);
  state.auth = { churchId: church, isAdmin: false };
  state.featureError = "You do not have access to this feature.";
  assert.equal((await action({ cursor })).ok, false);
  assert.deepEqual(state.features, ["website"]);
  assert.equal(http.mock.callCount(), 0);
});

test("inbox read uses only the authenticated church and a stable timestamp/id boundary", async t => {
  configure(t);
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    assert.equal(url.hostname, "inbox-pagination.example.test");
    return Response.json([raw(199)]);
  });
  const action = (await actions()).loadOlderContactSubmissions;
  const result = await action({ cursor });
  assert.equal(result.ok, true, "authorized non-admin staff may read the inbox");
  assert.equal(requests[0].searchParams.get("church_id"), `eq.${church}`);
  assert.equal(requests[0].searchParams.get("order"), "created_at.desc,id.desc");
  assert.equal(requests[0].searchParams.get("limit"), "201");
  assert.equal(requests[0].searchParams.get("or"), `(created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${cursor.id}))`);
  assert.equal((await action({ cursor, churchId: "another-church" })).ok, false);
  assert.equal((await action({ cursor: { ...cursor, createdAt: "now),church_id.neq.fake" } })).ok, false);
  assert.equal(requests.length, 1, "foreign church selection/malformed cursors never reach HTTP");
});

test("201-row lookahead returns exactly 200 messages without skipping timestamp ties", async t => {
  configure(t);
  const pages = [Array.from({ length: 201 }, (_, index) => raw(500 - index)), [raw(300), raw(299)]];
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    requests.push(new URL(input instanceof Request ? input.url : String(input)));
    return Response.json(pages.shift());
  });
  const first = await getContactSubmissionsPage(church);
  assert.equal(first.items.length, 200);
  assert.deepEqual(first.nextCursor, { createdAt: timestamp, id: id(301) });
  const second = await getContactSubmissionsPage(church, first.nextCursor);
  assert.deepEqual(second.items.map(row => row.id), [id(300), id(299)]);
  assert.equal(second.nextCursor, null);
  assert.ok(requests[1].searchParams.get("or")?.includes(`id.lt.${id(301)}`));
});

test("legacy inbox reads retain their status-filtered first-page interface", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.searchParams.get("status"), "eq.archived");
    return Response.json([raw(1)]);
  });
  assert.equal((await getContactSubmissions(church, "archived")).length, 1);
});

test("older-message failures preserve existing messages and return a safe retry message", async t => {
  configure(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "test_database_failure", message: "Secret SQL table failure" }, { status: 400 }));
  const result = await (await actions()).loadOlderContactSubmissions({ cursor });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /older messages/);
  assert.match(result.error, /kept/);
  assert.doesNotMatch(result.error, /Secret SQL/);
});
