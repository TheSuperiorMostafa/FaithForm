import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { hashStreamSecret } from "@/lib/stream/device-secret";

const churchId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const originalPepper = process.env.STREAM_DEVICE_SECRET_PEPPER;
process.env.STREAM_DEVICE_SECRET_PEPPER = "safe-encoder-state-test-pepper";
after(() => {
  if (originalPepper === undefined) delete process.env.STREAM_DEVICE_SECRET_PEPPER;
  else process.env.STREAM_DEVICE_SECRET_PEPPER = originalPepper;
});
const state = {
  device: { id: "device-1", church_id: churchId, device_secret_hash: hashStreamSecret("safe-paired-device-secret") },
  active: { id: sessionId, encoderDeviceId: "device-1" } as { id: string; encoderDeviceId: string } | null,
  ended: [] as unknown[],
};
Object.assign(globalThis, { __encoderStateRouteTest: state });
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
const { build } = tsxRequire("esbuild");
type Builder = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string; namespace: string } | undefined) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { loader: string; contents: string }) => void;
};
let route: Promise<{ POST: (request: Request) => Promise<Response> }> | undefined;

function load() {
  route ??= (async () => {
    const mocks: Record<string, string> = {
      "@/lib/stream/encoder": "export async function getEncoderDeviceBySecret(){return globalThis.__encoderStateRouteTest.device} export async function touchEncoderDevice(){}",
      "@/lib/stream/sessions": `export async function getActiveStreamSession(id){if(id!==${JSON.stringify(churchId)})throw new Error('wrong church');return globalThis.__encoderStateRouteTest.active}`,
      "@/lib/stream/go-live": "export async function endLiveBroadcast(id,db,options){globalThis.__encoderStateRouteTest.ended.push({churchId:id,...options})}",
    };
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../../app/api/stream/encoder/state/route.ts", import.meta.url))],
      bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
      plugins: [{ name: "encoder-state-test", setup(builder: Builder) {
        builder.onResolve({ filter: /^@\// }, (args: { path: string }) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "state-test" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "state-test" }, (args: { path: string }) => ({ loader: "js", contents: mocks[args.path] }));
      } }],
    });
    const compiled = { exports: {} as { POST: (request: Request) => Promise<Response> } };
    new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiled, compiled.exports);
    return compiled.exports;
  })();
  return route;
}

function request(body: unknown, secret = "safe-paired-device-secret") {
  return new Request("https://faithform.example.test/api/stream/encoder/state", {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("a paired OBS confirmed stop ends exactly its current church service", async () => {
  state.active = { id: sessionId, encoderDeviceId: "device-1" }; state.ended = [];
  const response = await (await load()).POST(request({ event: "stopped", sessionId }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.ended, [{ churchId, expectedSessionId: sessionId }]);
});

test("stale sessions and other paired devices cannot end the active service", async () => {
  state.ended = [];
  for (const active of [
    { id: "33333333-3333-4333-8333-333333333333", encoderDeviceId: "device-1" },
    { id: sessionId, encoderDeviceId: "another-church-device" },
    null,
  ]) {
    state.active = active;
    assert.equal((await (await load()).POST(request({ event: "stopped", sessionId }))).status, 200);
  }
  assert.deepEqual(state.ended, []);
});

test("invalid device credentials and transitional state reports never stop a service", async () => {
  state.active = { id: sessionId, encoderDeviceId: "device-1" }; state.ended = [];
  const api = await load();
  assert.equal((await api.POST(request({ event: "stopped", sessionId }, "wrong-device-secret"))).status, 401);
  assert.equal((await api.POST(request({ event: "reconnecting", sessionId }))).status, 400);
  assert.equal((await api.POST(request({ event: "stopped", sessionId: "bad-id" }))).status, 400);
  assert.deepEqual(state.ended, []);
});
