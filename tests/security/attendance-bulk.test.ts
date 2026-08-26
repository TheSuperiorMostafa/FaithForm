import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MAX_BULK_MEMBERS, markPresentBulk } from "@/lib/attendance/v2/roster";
import { VisitorError } from "@/lib/faithful/errors";

const batchSql = readFileSync("supabase/migrations/0056_attendance_batch.sql", "utf8");
const roster = readFileSync("lib/attendance/v2/roster.ts", "utf8");
const actions = readFileSync("app/dashboard/attendance/services/actions.ts", "utf8");
const uiRoot = readFileSync("components/attendance/service-occurrences-board.tsx", "utf8");

/** SQL with `--` comments stripped, so an assertion cannot match my own prose. */
const sql = batchSql.replace(/--.*$/gm, "");

/**
 * A fake `rpc` that records what it was called with and returns a canned row
 * set. The real semantics are proven against Postgres in
 * `tests/database/attendance-concurrency.test.ts`; what is proven here is that
 * the TypeScript wrapper hands the database the right call and faithfully
 * relays what comes back.
 */
function fakeClient(
  handler: (fn: string, params: Record<string, unknown>) => { data?: unknown; error?: unknown },
) {
  const calls: { fn: string; params: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return handler(fn, params);
    },
  };
  return { client: client as never, calls };
}

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );

// ---------------------------------------------------------------------------
// One transaction, one round trip, one command
// ---------------------------------------------------------------------------

test("a whole roster is one call, not one call per person", async () => {
  const members = ids(400);
  const { client, calls } = fakeClient((_fn, params) => ({
    data: (params.p_member_ids as string[]).map((memberId) => ({
      member_id: memberId,
      outcome: "counted",
      reason: "counted",
    })),
  }));

  const results = await markPresentBulk({
    churchId: "church-1",
    occurrenceId: "occ-1",
    memberIds: members,
    actorUserId: "user-1",
    batchKey: "batch-1",
    client,
  });

  assert.equal(calls.length, 1, "400 people must not be 400 round trips");
  assert.equal(calls[0].fn, "record_attendance_batch");
  assert.equal(results.length, 400);
});

test("the wrapper delegates to the one command and inserts nothing itself", () => {
  assert.match(sql, /from public\.record_attendance\(/);
  assert.ok(
    !/insert\s+into\s+public\.attendance_(facts|attempts|corrections)/i.test(sql),
    "a second insert path would be a second attendance authority",
  );
  assert.ok(!/update\s+public\.attendance_/i.test(sql));
  assert.ok(!/delete\s+from/i.test(sql));
});

test("the batch is one transaction — a plpgsql function body is exactly that", () => {
  assert.match(sql, /language plpgsql/);
  // No savepoints, no exception handler swallowing a failure per person: an
  // unexpected error must take the whole batch down rather than half-apply it.
  assert.ok(!/\bsavepoint\b/i.test(sql), "a savepoint would allow a partial batch");
  assert.ok(
    !/\bexception\s+when\b/i.test(sql),
    "catching per person would convert a system failure into a silent partial apply",
  );
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("each person gets their own key derived from the batch key", () => {
  assert.match(sql, /p_batch_key \|\| ':' \|\| target::text/);
});

test("a repeated batch key sends the same keys, so the database can recognise it", async () => {
  const members = ids(3);
  const seen: string[] = [];
  const { client } = fakeClient((_fn, params) => {
    seen.push(params.p_batch_key as string);
    return { data: [] };
  });

  const call = () =>
    markPresentBulk({
      churchId: "church-1",
      occurrenceId: "occ-1",
      memberIds: members,
      actorUserId: "user-1",
      batchKey: "stable-key",
      client,
    });

  await call();
  await call();

  assert.deepEqual(seen, ["stable-key", "stable-key"]);
});

test("the dashboard action supplies a batch key rather than leaving it to chance", () => {
  assert.match(actions, /batchKey: input\.batchKey \?\? randomUUID\(\)/);
});

test("the UI reuses one key across a retry of the same submission", () => {
  // A fresh key per click would make a retry a second batch, which is exactly
  // the double-count the key exists to prevent.
  assert.match(uiRoot, /batchKey/);
});

// ---------------------------------------------------------------------------
// Duplicates within one batch
// ---------------------------------------------------------------------------

test("the same person twice in one batch is processed once", () => {
  assert.match(sql, /if target = any \(seen\) then\s+continue;/);
  assert.match(sql, /seen := seen \|\| target;/);
});

test("a duplicate yields one result row, not two", async () => {
  const person = ids(1)[0];
  const { client } = fakeClient((_fn, params) => {
    const unique = [...new Set(params.p_member_ids as string[])];
    return {
      data: unique.map((memberId) => ({
        member_id: memberId,
        outcome: "counted",
        reason: "counted",
      })),
    };
  });

  const results = await markPresentBulk({
    churchId: "church-1",
    occurrenceId: "occ-1",
    memberIds: [person, person, person],
    actorUserId: "user-1",
    batchKey: "batch-1",
    client,
  });

  assert.equal(results.length, 1);
});

// ---------------------------------------------------------------------------
// Per-person outcomes are answers, not failures
// ---------------------------------------------------------------------------

test("a mixed batch relays every person's own outcome", async () => {
  const [a, b, c] = ids(3);
  const outcomes: Record<string, [string, string]> = {
    [a]: ["counted", "counted"],
    [b]: ["already_counted", "already_counted"],
    [c]: ["rejected", "member_not_in_church"],
  };

  const { client } = fakeClient((_fn, params) => ({
    data: (params.p_member_ids as string[]).map((memberId) => ({
      member_id: memberId,
      outcome: outcomes[memberId][0],
      reason: outcomes[memberId][1],
    })),
  }));

  const results = await markPresentBulk({
    churchId: "church-1",
    occurrenceId: "occ-1",
    memberIds: [a, b, c],
    actorUserId: "user-1",
    batchKey: "batch-1",
    client,
  });

  assert.deepEqual(results, [
    { memberId: a, outcome: "counted", reason: "counted" },
    { memberId: b, outcome: "already_counted", reason: "already_counted" },
    { memberId: c, outcome: "rejected", reason: "member_not_in_church" },
  ]);
});

test("an unauthorized member is rejected without a raise, so the rest commits", () => {
  // `member_not_in_church` is a verdict inside `record_attendance`, not an
  // exception — which is what lets the other people in the batch stand.
  const authority = readFileSync(
    "supabase/migrations/0055_attendance_authority.sql",
    "utf8",
  ).replace(/--.*$/gm, "");
  assert.match(authority, /'member_not_in_church'/);
  const rejectionBlock = authority.slice(
    authority.indexOf("'member_not_in_church'") - 400,
    authority.indexOf("'member_not_in_church'") + 200,
  );
  assert.ok(
    !/raise exception/i.test(rejectionBlock),
    "a wrong-tenant member must be a verdict, not a rollback",
  );
});

// ---------------------------------------------------------------------------
// What does roll the whole batch back
// ---------------------------------------------------------------------------

test("an oversized batch is refused before any person is touched", () => {
  const guard = sql.slice(0, sql.indexOf("foreach target in array"));
  assert.match(guard, /if member_count > 1000 then/);
  assert.match(guard, /raise exception 'batch too large/);
});

test("an unknown occurrence fails the call rather than rejecting a thousand times", () => {
  const guard = sql.slice(0, sql.indexOf("foreach target in array"));
  assert.match(guard, /raise exception 'occurrence not found'/);
});

test("the TypeScript bound matches the SQL bound", () => {
  assert.equal(MAX_BULK_MEMBERS, 1000);
  assert.match(sql, /if member_count > 1000 then/);
});

test("an oversized batch is refused locally with a usable message", async () => {
  const { client, calls } = fakeClient(() => ({ data: [] }));

  await assert.rejects(
    markPresentBulk({
      churchId: "church-1",
      occurrenceId: "occ-1",
      memberIds: ids(MAX_BULK_MEMBERS + 1),
      actorUserId: "user-1",
      batchKey: "batch-1",
      client,
    }),
    (error: unknown) =>
      error instanceof VisitorError &&
      error.code === "invalid_input" &&
      error.message === "Mark at most 1000 people at once.",
  );

  assert.equal(calls.length, 0, "an oversized batch must not reach the database");
});

test("an empty batch is a no-op, not a call", async () => {
  const { client, calls } = fakeClient(() => ({ data: [] }));
  const results = await markPresentBulk({
    churchId: "church-1",
    occurrenceId: "occ-1",
    memberIds: [],
    actorUserId: "user-1",
    batchKey: "batch-1",
    client,
  });
  assert.deepEqual(results, []);
  assert.equal(calls.length, 0);
});

test("a rolled-back batch surfaces as unavailable, with no driver detail", async () => {
  const { client } = fakeClient(() => ({
    error: {
      message: 'duplicate key value violates unique constraint "attendance_facts_unique_idx"',
      details: "Key (service_occurrence_id, member_id)=(…) already exists.",
    },
  }));

  await assert.rejects(
    markPresentBulk({
      churchId: "church-1",
      occurrenceId: "occ-1",
      memberIds: ids(2),
      actorUserId: "user-1",
      batchKey: "batch-1",
      client,
    }),
    (error: unknown) => {
      assert.ok(error instanceof VisitorError);
      assert.equal(error.code, "unavailable");
      // A constraint name or a key tuple must never reach a browser.
      assert.ok(!error.message.includes("attendance_facts_unique_idx"));
      assert.ok(!error.message.includes("service_occurrence_id"));
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Authority and tenancy
// ---------------------------------------------------------------------------

test("the wrapper is service-role only", () => {
  assert.match(sql, /revoke all on function public\.record_attendance_batch\([\s\S]*?\)\s*from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.record_attendance_batch\([\s\S]*?\)\s*to service_role;/);
});

test("the wrapper pins its search path", () => {
  assert.match(sql, /security definer\s+set search_path = public/);
});

test("no caller may name a church", () => {
  // The church comes from the occurrence, exactly as in a single check-in.
  assert.ok(!/p_church_id/.test(sql), "a caller-supplied church would be a tenancy hole");
  assert.match(actions, /const \{ churchId, userId \} = await requireAttendanceStaff\(\)/);
});

test("bulk marking requires staff, and the action never trusts a client church", () => {
  const bulkAction = actions.slice(
    actions.indexOf("export async function markRosterPresent"),
    actions.indexOf("/** Reverse or restore"),
  );
  assert.match(bulkAction, /requireAttendanceStaff\(\)/);
  assert.ok(!bulkAction.includes("input.churchId"));
});

// ---------------------------------------------------------------------------
// Simultaneity with the other sources
// ---------------------------------------------------------------------------

test("a batch shares the single unique index with geofence, QR and kiosk", () => {
  // The batch has no privileged path around the invariant: it reaches
  // `attendance_facts` only through `record_attendance`, whose insert is
  // `on conflict do nothing` against the same index every other source hits.
  const authority = readFileSync(
    "supabase/migrations/0055_attendance_authority.sql",
    "utf8",
  );
  assert.match(
    authority,
    /on conflict \(service_occurrence_id, member_id\) do nothing/,
  );
  assert.match(sql, /from public\.record_attendance\(/);

  // Observed, not merely constructed: two concurrent batches, and a batch
  // racing single check-ins, are executed against real Postgres.
  const dbTest = readFileSync("tests/database/attendance-concurrency.test.ts", "utf8");
  assert.match(dbTest, /two connections running the same batch produce one fact per person/);
  assert.match(dbTest, /mixed sources racing the same person still produce one fact/);
});

test("the batch does not log", () => {
  const bulk = roster.slice(
    roster.indexOf("export async function markPresentBulk"),
    roster.indexOf("/** A single manual add"),
  );
  assert.equal((bulk.match(/console\./g) ?? []).length, 0);
  assert.ok(!/raise notice/i.test(sql), "a notice would put member ids in the server log");
});
