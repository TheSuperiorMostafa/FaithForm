import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { updateGathering } from "@/lib/groups/gatherings";

const input = {
  churchId: "church-qa",
  groupId: "group-qa",
  eventId: "event-qa",
  churchTimezone: "America/New_York",
  actor: { type: "staff" as const, userId: "staff-qa" },
  values: {
    title: "QA meeting",
    startsAt: "2026-09-30T22:00:00.000Z",
    endsAt: "2026-09-30T23:00:00.000Z",
    timezone: "America/New_York",
  },
};

function mockClient(options: {
  count?: number | null;
  countError?: boolean;
  meetingRows?: number;
  syncError?: boolean;
  syncRows?: number;
} = {}) {
  const writes: string[] = [];
  const chain = (result: Record<string, unknown>) => ({
    eq() { return this; },
    select() { return this; },
    maybeSingle: async () => result,
    then: (resolve: (value: Record<string, unknown>) => unknown) => Promise.resolve(result).then(resolve),
  });
  const client = {
    from(table: string) {
      if (table === "group_events") return {
        select: () => chain({ data: { id: input.eventId, status: "scheduled" }, error: null }),
        update: () => { writes.push("meeting"); return chain({ data: options.meetingRows === 0 ? [] : [{ id: input.eventId }], error: null }); },
      };
      if (table === "service_occurrences") return {
        select: () => chain({ data: { id: "occurrence-qa" }, error: null }),
        update: () => { writes.push("attendance window"); return chain({ data: options.syncRows === 0 ? [] : [{ id: "occurrence-qa" }], error: options.syncError ? new Error("database error") : null }); },
      };
      if (table === "attendance_facts") return {
        select: () => chain({ count: options.count ?? 0, error: options.countError ? new Error("database error") : null }),
      };
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc() { return { error: null }; },
  };
  return { admin: client as unknown as SupabaseClient, writes };
}

test("a failed attendance check cannot shift a meeting with unknown history", async () => {
  const { admin, writes } = mockClient({ countError: true });
  await assert.rejects(updateGathering(admin, input), /Could not check this meeting's attendance window/);
  assert.deepEqual(writes, []);
});

test("a meeting with recorded attendance keeps its historical check-in window", async () => {
  const { admin, writes } = mockClient({ count: 1 });
  await updateGathering(admin, input);
  assert.deepEqual(writes, ["meeting"]);
});

test("a failed attendance-window update is reported rather than silently accepted", async () => {
  const { admin, writes } = mockClient({ syncError: true });
  await assert.rejects(updateGathering(admin, input), /meeting saved, but its attendance time did not update/i);
  assert.deepEqual(writes, ["meeting", "attendance window"]);
});

test("a concurrent removal cannot report an untouched meeting as saved", async () => {
  const { admin, writes } = mockClient({ meetingRows: 0 });
  await assert.rejects(updateGathering(admin, input), /Could not save that gathering/);
  assert.deepEqual(writes, ["meeting"]);
});

test("an attendance-window update affecting no row is reported", async () => {
  const { admin, writes } = mockClient({ syncRows: 0 });
  await assert.rejects(updateGathering(admin, input), /meeting saved, but its attendance time did not update/i);
  assert.deepEqual(writes, ["meeting", "attendance window"]);
});
