import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import { require as loadTypeScript } from "tsx/cjs/api";

process.env.CRON_SECRET = "operations-route-test-only-secret";
const calls = [];
let failed = false;
let schemaMissing = false;
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === "@/lib/operations/alerts") return {
    runOperationsMonitor: async (args) => {
      calls.push(args);
      if (failed) throw new Error("sensitive provider diagnostic");
      return { healthy: false, failedChecks: 2, alert: schemaMissing ? "disabled" : "sent" };
    },
  };
  return originalLoad.apply(this, arguments);
};
try {
  const { GET, POST } = loadTypeScript(path.join(process.cwd(), "app/api/webhooks/operations/monitor/route.ts"), import.meta.url);
  const request = (method = "GET", body, authenticated = true) => new Request("https://faithform.invalid/api/webhooks/operations/monitor", {
    method, headers: authenticated ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await GET(request("GET", undefined, false))).status, 401);
  assert.equal((await POST(request("POST", { test: true }, false))).status, 401);
  assert.equal(calls.length, 0);
  const checked = await GET(request());
  assert.equal(checked.status, 200);
  assert.equal(checked.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, [{ test: false }]);
  assert.equal((await POST(request("POST", { test: true, to: "forged@example.invalid" }))).status, 400);
  assert.equal((await POST(request("POST", { test: false }))).status, 400);
  assert.equal(calls.length, 1);
  assert.equal((await POST(request("POST", { test: true }))).status, 200);
  assert.deepEqual(calls[1], { test: true });
  schemaMissing = true;
  const disabled = await GET(request());
  assert.equal(disabled.status, 200);
  assert.deepEqual(await disabled.json(), { ok: true, alert: "disabled" });
  assert.equal((await POST(request("POST", { test: true }))).status, 503);
  failed = true;
  const failure = await GET(request());
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /sensitive provider diagnostic/);
  console.log("Passed operations monitor route");
} finally { Module._load = originalLoad; }
