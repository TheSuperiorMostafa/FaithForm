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

function mockClient(outcome: string | null = "updated", error: Error | null = null) {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  const admin = {
    async rpc(name: string, params: Record<string, unknown>) {
      calls.push({ name, params });
      return { data: outcome, error };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

test("a meeting save submits its church, event, and time in one database call", async () => {
  const { admin, calls } = mockClient();
  await updateGathering(admin, input);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "update_group_gathering");
  assert.equal(calls[0].params.p_church_id, input.churchId);
  assert.equal(calls[0].params.p_event_id, input.eventId);
  assert.equal(calls[0].params.p_starts_at, input.values.startsAt);
});

test("a recorded attendance window rejects a time edit", async () => {
  const { admin } = mockClient("attendance_locked");
  await assert.rejects(updateGathering(admin, input), /Attendance has been recorded/);
});

test("missing and cancelled meetings give clear outcomes", async () => {
  await assert.rejects(updateGathering(mockClient("not_found").admin, input), /not found/);
  await assert.rejects(updateGathering(mockClient("cancelled").admin, input), /cancelled gathering/);
});

test("a database failure never reports the meeting as saved", async () => {
  await assert.rejects(updateGathering(mockClient(null, new Error("database error")).admin, input), /Could not save/);
  await assert.rejects(updateGathering(mockClient(null).admin, input), /Could not save/);
});

test("invalid meeting input is rejected before a database call", async () => {
  const { admin, calls } = mockClient();
  await assert.rejects(updateGathering(admin, { ...input, values: { ...input.values, title: "" } }), /name/);
  assert.equal(calls.length, 0);
});
