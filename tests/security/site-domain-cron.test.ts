import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/api/sites/domains/reconcile/route";

test("the background domain worker rejects absent and incorrect cron credentials before database access", async t => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-only-cron-authorization";
  t.after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unauthorized requests must not access the database"); });
  const requests: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { authorization: "test-only-cron-authorization" }];
  for (const headers of requests) {
    assert.equal((await GET(new Request("https://faithform.example/api/sites/domains/reconcile", { headers }))).status, 401);
  }
  delete process.env.CRON_SECRET;
  assert.equal((await GET(new Request("https://faithform.example/api/sites/domains/reconcile", { headers: { authorization: "Bearer test-only-cron-authorization" } }))).status, 401);
});
