import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkOperationsHealth } from "@/lib/operations/health";

function fakeClient(results: Record<string, { count: number | null; error?: unknown }>) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const builder = {
        select: (_columns: string, options: unknown) => { assert.deepEqual(options, { count: "exact", head: true }); return builder; },
        eq: (key: string, value: unknown) => { call.filters.push([key, value]); return builder; },
        lte: (key: string, value: unknown) => { call.filters.push([key, value]); return builder; },
        not: (key: string, operator: string, value: unknown) => { call.filters.push([key, [operator, value]]); return builder; },
        or: (expression: string) => { call.filters.push(["or", expression]); return builder; },
        then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(results[table] ?? { count: 0, error: null })),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test("healthy queues return counts only and never fetch customer rows", async () => {
  const { client } = fakeClient({});
  const health = await checkOperationsHealth({ client, now: new Date("2026-10-03T12:00:00Z") });
  assert.equal(health.ok, true);
  assert.ok(health.checks.length >= 18);
  assert.ok(health.checks.every(check => check.count === 0 && check.ok));
  assert.deepEqual(Object.keys(health.checks[0]), ["name", "count", "ok"]);
});

test("failed and stalled jobs make health non-success", async () => {
  const { client } = fakeClient({ messaging_sync_jobs: { count: 2 } });
  const health = await checkOperationsHealth({ client });
  assert.equal(health.ok, false);
  assert.equal(health.checks.find(check => check.name === "messaging_failed")?.count, 2);
});

test("unavailable schema or missing counts cannot report a healthy deployment", async () => {
  for (const result of [{ count: null }, { count: 0, error: { message: "private database payload" } }]) {
    const { client } = fakeClient({ giving_recurring_cancellation_jobs: result });
    const health = await checkOperationsHealth({ client });
    assert.equal(health.ok, false);
    assert.equal(health.checks.find(check => check.name === "gift_cancellations_overdue")?.count, null);
    assert.ok(!JSON.stringify(health).includes("private database payload"));
  }
});

test("hourly workers receive grace and deliberate email opt-out is excluded", async () => {
  const { client, calls } = fakeClient({});
  await checkOperationsHealth({ client, now: new Date("2026-10-03T12:00:00Z") });
  assert.ok(calls.some(call => call.table === "giving_recurring_cancellation_jobs" &&
    call.filters.some(([key, value]) => key === "next_attempt_at" && value === "2026-10-03T10:00:00.000Z")));
  assert.ok(calls.some(call => call.table === "giving_donations" &&
    call.filters.some(([key, value]) => key === "or" && String(value).includes("neq.emails_disabled"))));
});
