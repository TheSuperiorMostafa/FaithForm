import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runAttendanceCleanup,
  runKioskCleanup,
  runOccurrenceGeneration,
  runOccurrenceLifecycle,
} from "@/lib/attendance/v2/jobs";

type Result = { data?: unknown; count?: number | null; error?: { message: string } | null };
const failure = { data: null, error: { message: "private driver payload" } };
function fakeDb(results: Result[]) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const query = {
        select: () => query, update: () => query, order: () => query,
        range: () => query, limit: () => query, not: () => query,
        lte: () => query, gt: () => query, lt: () => query,
        in: () => query,
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return query; },
        then: (resolve: (result: Result) => unknown) => Promise.resolve(resolve(results.shift() ?? { data: [], error: null })),
      };
      return query;
    },
    rpc: () => Promise.resolve(results.shift() ?? { data: [], error: null }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

test("generation refuses failed count or church list instead of claiming an empty run", async () => {
  await assert.rejects(runOccurrenceGeneration({ client: fakeDb([failure]).client }), /church count failed/);
  await assert.rejects(runOccurrenceGeneration({ client: fakeDb([{ count: 4 }, failure]).client }), /church list failed/);
});

test("a church synchronization failure is reported and later churches are still attempted", async () => {
  const { client } = fakeDb([
    { count: 2 }, { data: [{ id: "church-a" }, { id: "church-b" }] },
    failure, { data: [{ refreshed: 2, retired: 1 }] }, { data: [{ created: 3, skipped: 4 }] },
  ]);
  const result = await runOccurrenceGeneration({ client });
  assert.equal(result.churchesFailed, 1);
  assert.equal(result.churchesProcessed, 1);
  assert.equal(result.occurrencesCreated, 3);
});

test("either lifecycle update error rejects with sanitized text", async () => {
  for (const results of [[failure, { data: [] }], [{ data: [] }, failure]]) {
    await assert.rejects(runOccurrenceLifecycle(new Date(), fakeDb(results).client), {
      message: "Attendance lifecycle update failed",
    });
  }
});

test("cleanup checks every read, write, and RPC error", async () => {
  const cases: Array<[Result[], RegExp]> = [
    [[failure], /evidence cleanup read failed/],
    [[{ data: [{ id: "evidence" }] }, failure], /evidence purge failed/],
    [[{ data: [] }, failure], /stalled attempts read failed/],
    [[{ data: [] }, { data: [{ id: "stalled" }] }, failure], /stalled attempts expiration failed/],
    [[{ data: [] }, { data: [] }, failure], /detection purge failed/],
    [[{ data: [] }, { data: [] }, { data: 0 }, failure], /check-in artifact purge failed/],
  ];
  for (const [results, message] of cases) {
    await assert.rejects(runAttendanceCleanup({ client: fakeDb(results).client }), message);
  }
  await assert.rejects(runKioskCleanup(new Date(), fakeDb([failure]).client), /kiosk cleanup failed/);
});

test("stalled-attempt expiry rechecks status and counts only changed rows", async () => {
  const { client, calls } = fakeDb([
    { data: [] }, { data: [{ id: "changed-since-read" }] }, { data: [] },
    { data: 0 }, { data: [{ codes_removed: 0, pairings_removed: 0, scans_removed: 0 }] },
  ]);
  const result = await runAttendanceCleanup({ client });
  assert.equal(result.attemptsExpired, 0);
  assert.deepEqual(calls[2].filters, [["status", "pending_confirmation"]]);
});

test("deadline starts four churches fairly, reports interruption, and defers later work", async () => {
  async function interruptedRun(now: Date) {
    const controller = new AbortController();
    const started: string[] = [];
    const { client } = fakeDb([
      { count: 8 }, { data: Array.from({ length: 8 }, (_, index) => ({ id: `church-${index}` })) },
    ]);
    client.rpc = ((_name: string, input: { p_church_id: string }) => {
      started.push(input.p_church_id);
      const result = new Promise(resolve => {
        controller.signal.addEventListener("abort", () => resolve(failure), { once: true });
      });
      if (started.length === 4) controller.abort();
      return result;
    }) as unknown as typeof client.rpc;
    const result = await runOccurrenceGeneration({ client, signal: controller.signal, now });
    assert.equal(new Set(started).size, 4);
    assert.equal(result.churchesFailed, 4);
    assert.equal(result.churchesTimedOut, 4);
    assert.equal(result.churchesDeferred, 4);
    return started;
  }
  const first = await interruptedRun(new Date("2026-10-03T00:00:00Z"));
  const next = await interruptedRun(new Date("2026-10-03T00:10:00Z"));
  assert.notDeepEqual(first, next, "each batch visit changes who starts before the deadline");
});
