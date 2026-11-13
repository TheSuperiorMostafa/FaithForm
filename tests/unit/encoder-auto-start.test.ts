import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { createClient } from "@supabase/supabase-js";

const churchId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const otherSourceId = "33333333-3333-4333-8333-333333333333";
type Row = {
  enabled: boolean; authorized_source_id: string | null; authorized_at: string | null;
  source_id: string | null; source_stopped: boolean; session_id: string | null; stop_after: string | null;
};
type Session = { id: string; status: string; streamEventId: string | null };
type Signal = { path: string; sourceId: string; event: "publish" | "unpublish" };
type Automation = {
  authorizeEncoderSource: (churchId: string, sourceId: unknown) => Promise<void>;
  handleEncoderSignal: (churchId: string, body: Signal) => Promise<void>;
};
const state = {
  db: createClient("https://encoder-start.example.test", "safe-test-service-key", { auth: { persistSession: false, autoRefreshToken: false } }),
  row: null as Row | null, active: null as Session | null, starts: 0, ingests: 0,
  queries: [] as { method: string; url: URL; body: Record<string, unknown> }[],
  failRegistration: false, failAuthRegistration: false, authRegistrations: 0, feature: true,
};
Object.assign(globalThis, { __encoderAutoStartTest: state });
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
type Builder = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }) => void;
};
const { build } = tsxRequire("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };
let automationModule: Promise<Automation> | null = null;
let authModule: Promise<{ POST: (request: Request) => Promise<Response> }> | null = null;

async function compile<T>(relativePath: string, mocks: Record<string, string>): Promise<T> {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const built = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", target: "node20", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)), plugins: [{ name: "encoder-auto-start", setup(builder: Builder) {
    builder.onResolve({ filter: /^@\// }, args => args.importer === path && Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "encoder-test" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "encoder-test" }, args => ({ loader: "js", contents: mocks[args.path] }));
  } }] });
  const compiledModule = { exports: {} as T };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

function automation() {
  automationModule ??= compile<Automation>("../../lib/stream/encoder-automation.ts", {
    "@/lib/supabase/admin": "export function createAdminClient(){return globalThis.__encoderAutoStartTest.db}",
    "@/lib/stream/encoder-automation-settings": "export async function withBroadcastOperation(id,db,fn){return fn()}",
    "@/lib/stream/events": "export async function getStreamEvent(){return null} export async function getStreamEventNearEncoderStart(){return null}",
    "@/lib/stream/go-live": `export async function startLiveBroadcastLocked(id,actor,options){
      if(id!==${JSON.stringify(churchId)}||actor!==null||!options.encoderIngestReady)throw new Error('wrong start authority');
      const s=globalThis.__encoderAutoStartTest;s.starts++;s.active={id:'session-1',status:'waiting_for_encoder',streamEventId:null};return s.active;
    } export async function onIngestStarted(){const s=globalThis.__encoderAutoStartTest;s.ingests++;s.active.status='live'} export async function endLiveBroadcastLocked(){throw new Error('unexpected stop')}`,
    "@/lib/stream/preview-ingest": "export async function isPreviewIngestActive(){return false}",
    "@/lib/stream/sessions": "export async function getActiveStreamSession(){return globalThis.__encoderAutoStartTest.active} export async function updateStreamSession(id,patch){Object.assign(globalThis.__encoderAutoStartTest.active,patch);return globalThis.__encoderAutoStartTest.active}",
  });
  return automationModule;
}

function publishAuth() {
  authModule ??= compile<{ POST: (request: Request) => Promise<Response> }>("../../app/api/stream/publish-auth/route.ts", {
    "@/lib/integrations/tokens": "export async function getIntegration(){return {access_token:'safe-permanent-church-key',metadata:{}}}",
    "@/lib/stream/relay": `export function parseStreamPath(path){return path==='live/${churchId}'?{churchId:'${churchId}',legacyCredentialInPath:false}:null} export function getStreamDestinationsFromMetadata(){return []}`,
    "@/lib/stream/ingest-token": "export function verifyIngestToken(){return null}",
    "@/lib/stream/encoder-automation": "export async function authorizeEncoderSource(){const s=globalThis.__encoderAutoStartTest;s.authRegistrations++;if(s.failAuthRegistration)throw new Error('injected registration failure')}",
  });
  return authModule;
}

function initialRow(enabled = false): Row {
  return { enabled, authorized_source_id: null, authorized_at: null, source_id: null, source_stopped: false, session_id: null, stop_after: null };
}

function configure(t: TestContext) {
  state.row = null; state.active = null; state.starts = 0; state.ingests = 0; state.queries = [];
  state.failRegistration = false; state.failAuthRegistration = false; state.authRegistrations = 0; state.feature = true;
  const oldSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;
  process.env.STREAM_RELAY_WEBHOOK_SECRET = "safe-relay-test-secret";
  t.after(() => { if (oldSecret === undefined) delete process.env.STREAM_RELAY_WEBHOOK_SECRET; else process.env.STREAM_RELAY_WEBHOOK_SECRET = oldSecret; });
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "encoder-start.example.test");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    state.queries.push({ method, url, body });
    if (url.pathname.endsWith("/church_features")) return Response.json({ enabled: state.feature });
    assert.ok(url.pathname.endsWith("/stream_encoder_automation"));
    if (method === "POST") {
      assert.equal(body.church_id, churchId);
      assert.equal(url.searchParams.get("on_conflict"), "church_id");
      assert.ok(init?.headers && new Headers(init.headers).get("prefer")?.includes("resolution=ignore-duplicates"));
      state.row ??= initialRow();
      return new Response(null, { status: 201 });
    }
    assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
    if (method === "PATCH") {
      if (state.failRegistration && Object.hasOwn(body, "authorized_source_id")) return Response.json({ code: "XX000", message: "injected registration failure" }, { status: 503 });
      const allowed = !url.searchParams.has("or") || state.row?.enabled || state.row?.stop_after;
      if (state.row && allowed) Object.assign(state.row, body);
      return url.searchParams.has("select") ? Response.json(state.row && allowed ? { church_id: churchId } : null) : new Response(null, { status: 204 });
    }
    return Response.json(state.row);
  });
}

const publish: Signal = { path: `live/${churchId}`, event: "publish", sourceId };

test("a permanent-key encoder arriving before setup is remembered without enabling or starting a broadcast", async t => {
  configure(t);
  const api = await automation();
  await api.authorizeEncoderSource(churchId, sourceId);
  assert.equal(state.row?.authorized_source_id, sourceId);
  assert.equal(state.row?.enabled, false);
  await api.handleEncoderSignal(churchId, publish);
  assert.equal(state.starts, 0);
  assert.equal(state.ingests, 0);
});

test("turning automatic Go Live on during an existing private encoder feed starts on its next heartbeat exactly once", async t => {
  configure(t); state.row = initialRow();
  const api = await automation();
  await api.authorizeEncoderSource(churchId, sourceId);
  await api.handleEncoderSignal(churchId, publish);
  assert.equal(state.starts, 0);
  state.row.enabled = true;
  await api.handleEncoderSignal(churchId, publish);
  await api.handleEncoderSignal(churchId, publish);
  assert.equal(state.starts, 1);
  assert.equal(state.ingests, 1);
  assert.equal(state.row.session_id, "session-1");
  assert.equal(state.row.source_id, sourceId);
});

test("an enabled encoder starts automatically without a dashboard Go Live call", async t => {
  configure(t); state.row = initialRow(true);
  const api = await automation();
  await api.authorizeEncoderSource(churchId, sourceId);
  await api.handleEncoderSignal(churchId, publish);
  assert.equal(state.starts, 1); assert.equal(state.ingests, 1);
  assert.equal(state.active?.status, "live");
});

test("unproven sources, disabled streaming and ended connections cannot start another broadcast", async t => {
  configure(t); state.row = initialRow(true);
  const api = await automation();
  await api.authorizeEncoderSource(churchId, sourceId);
  await api.handleEncoderSignal(churchId, { ...publish, sourceId: otherSourceId });
  assert.equal(state.starts, 0);
  state.feature = false;
  await api.handleEncoderSignal(churchId, publish);
  assert.equal(state.starts, 0);
  state.feature = true;
  await api.handleEncoderSignal(churchId, publish);
  state.active = null;
  await api.handleEncoderSignal(churchId, publish);
  assert.equal(state.starts, 1, "same connection must not restart after an administrator ends it");
});

test("a refused authorization write is surfaced instead of claiming that source was recorded", async t => {
  configure(t); state.row = initialRow(true); state.failRegistration = true;
  const api = await automation();
  await assert.rejects(api.authorizeEncoderSource(churchId, sourceId));
  assert.equal(state.row.authorized_source_id, null);
});

test("a reconnect keeps the existing broadcast and late callbacks cannot replace its new source", async t => {
  configure(t); state.row = initialRow(true);
  const api = await automation();
  await api.authorizeEncoderSource(churchId, sourceId);
  await api.handleEncoderSignal(churchId, publish);
  await api.handleEncoderSignal(churchId, { ...publish, event: "unpublish" });
  assert.equal(state.row.source_stopped, true);
  await api.authorizeEncoderSource(churchId, otherSourceId);
  await api.handleEncoderSignal(churchId, { ...publish, sourceId: otherSourceId });
  await api.handleEncoderSignal(churchId, { ...publish, event: "unpublish" });
  assert.equal(state.starts, 1);
  assert.equal(state.row.session_id, "session-1");
  assert.equal(state.row.source_id, otherSourceId);
  assert.equal(state.row.source_stopped, false);
});

test("publish authentication refuses a lost encoder registration so hardware can reconnect and retry", async t => {
  configure(t); state.failAuthRegistration = true;
  const api = await publishAuth();
  const request = () => new Request("https://faithform.example.test/api/stream/publish-auth", { method: "POST", headers: { "x-stream-relay-secret": "safe-relay-test-secret", "content-type": "application/json" }, body: JSON.stringify({ action: "publish", path: `live/${churchId}`, protocol: "rtmp", id: sourceId, password: "safe-permanent-church-key" }) });
  assert.equal((await api.POST(request())).status, 503);
  state.failAuthRegistration = false;
  assert.equal((await api.POST(request())).status, 200);
  assert.equal(state.authRegistrations, 2);
});

test("unverified relay or church credentials cannot record an encoder identity", async t => {
  configure(t);
  const api = await publishAuth();
  for (const credentials of [
    { relay: "wrong-relay-secret", church: "safe-permanent-church-key" },
    { relay: "safe-relay-test-secret", church: "wrong-church-key" },
  ]) {
    const response = await api.POST(new Request("https://faithform.example.test/api/stream/publish-auth", {
      method: "POST", headers: { "x-stream-relay-secret": credentials.relay, "content-type": "application/json" },
      body: JSON.stringify({ action: "publish", path: `live/${churchId}`, protocol: "rtmp", id: sourceId, password: credentials.church }),
    }));
    assert.equal(response.status, 401);
  }
  assert.equal(state.authRegistrations, 0);
});
