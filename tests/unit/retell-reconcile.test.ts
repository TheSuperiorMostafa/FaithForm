import assert from "node:assert/strict";
import test from "node:test";
import { createRetellReconcileHandler, rotatingChurchBatch } from "@/lib/integrations/retell-reconcile";

function fakeAdmin(ids: string[], fails = false) {
  const reads: [number, number][] = [];
  return { reads, client: { from(table: string) {
    assert.equal(table, "voice_assistant_settings");
    const query = {
      select: () => query, not: () => query,
      order: (key: string) => { assert.equal(key, "church_id"); return query; },
      range: async (first: number, last: number) => {
        reads.push([first, last]);
        return { data: ids.slice(first, last + 1).map(church_id => ({ church_id })), error: fails ? { message: "private database error" } : null };
      },
    };
    return query;
  } } as never };
}
const authorized = () => new Request("https://example.test/api/webhooks/retell/reconcile", { headers: { Authorization: "Bearer correct" } });

test("cron authorization fails closed before credentials, database or provider access", async () => {
  let touched = false;
  for (const secret of [undefined, "correct"]) {
    const handler = createRetellReconcileHandler({ secret: () => secret, admin: () => { touched = true; throw Error(); }, importCalls: async () => { touched = true; return { imported: 0, skipped: 0 }; } });
    const response = await handler(new Request("https://example.test/"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  const handler = createRetellReconcileHandler({ secret: () => "correct", admin: () => { touched = true; throw Error(); }, importCalls: async () => ({ imported: 0, skipped: 0 }) });
  assert.equal((await handler(new Request("https://example.test/", { headers: { Authorization: "Bearer wrong" } }))).status, 401);
  assert.equal(touched, false);
});

test("paged mappings and a rotating batch reach churches beyond the first 100 with concurrency two", async () => {
  const ids = Array.from({ length: 105 }, (_, index) => `church-${String(index).padStart(3, "0")}`);
  const seen = new Set<string>();
  for (let slot = 0; slot < 27; slot++) for (const id of rotatingChurchBatch(ids, slot * 120_000)) seen.add(id);
  assert.equal(seen.size, 105);
  const db = fakeAdmin(ids);
  let active = 0, maxActive = 0;
  const called: string[] = [];
  const handler = createRetellReconcileHandler({ secret: () => "correct", admin: () => db.client, now: () => 25 * 120_000,
    importCalls: async (id, admin, signal) => { assert.equal(admin, db.client); assert.equal(signal.aborted, false); called.push(id); maxActive = Math.max(maxActive, ++active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return { imported: 1, skipped: 2 }; },
  });
  const response = await handler(authorized());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checked: 4, imported: 4, skipped: 8, failed: 0 });
  assert.equal(maxActive, 2);
  assert.deepEqual(db.reads, [[0, 99], [100, 199]]);
  assert.deepEqual(called, ids.slice(100, 104));
});

test("database and provider failures cannot report success or expose private details", async () => {
  const db = fakeAdmin(["private-church-id"], true);
  const failedRead = createRetellReconcileHandler({ secret: () => "correct", admin: () => db.client, importCalls: async () => { throw Error("should not run"); } });
  const response = await failedRead(authorized());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, checked: 0, imported: 0, skipped: 0, failed: 1 });
  const ready = fakeAdmin(["private-church-id"]);
  const providerFailed = createRetellReconcileHandler({ secret: () => "correct", admin: () => ready.client, importCalls: async () => { throw Error("secret provider response"); } });
  const failure = await providerFailed(authorized());
  assert.equal(failure.status, 503);
  const text = await failure.text();
  assert.equal(JSON.parse(text).ok, false);
  assert.doesNotMatch(text, /private-church-id|secret|provider response/);
});

test("an exhausted time budget defers work and reports failure instead of starting imports", async () => {
  const db = fakeAdmin(["church"]);let clock = 0;let calls = 0;
  const handler = createRetellReconcileHandler({ secret: () => "correct", admin: () => db.client, now: () => clock++ === 0 ? 0 : 49_000, importCalls: async () => { calls++;return { imported: 1, skipped: 0 }; } });
  const response = await handler(authorized());
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});
