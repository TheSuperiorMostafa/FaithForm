import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAttendanceSheet, submitAttendance } from "@/lib/groups/gatherings";

const event = {
  id: "event-qa",
  title: "QA meeting",
  starts_at: "2026-09-27T18:00:00Z",
  ends_at: "2026-09-27T19:00:00Z",
  timezone: "America/New_York",
  status: "scheduled",
};
const occurrence = {
  id: "occurrence-qa",
  checkin_opens_at_utc: "2026-09-26T18:00:00Z",
  checkin_closes_at_utc: "2026-10-27T19:00:00Z",
  status: "scheduled",
};

function mockClient(overrides: Record<string, Record<string, unknown>> = {}) {
  const defaults: Record<string, Record<string, unknown>> = {
    group_events: { data: event, error: null },
    group_memberships: { data: [], count: 0, error: null },
    service_occurrences: { data: occurrence, error: null },
    group_attendance_records: { data: null, error: null },
    attendance_facts: { data: [], count: 0, error: null },
    members: { data: [], error: null },
    visitor_accounts: { data: [], error: null },
  };
  const admin = {
    from(table: string) {
      const result = { ...defaults[table], ...overrides[table] };
      if (!defaults[table]) throw new Error(`Unexpected table: ${table}`);
      const query = {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        limit() { return this; },
        maybeSingle: async () => result,
        then: (resolve: (value: Record<string, unknown>) => unknown) => Promise.resolve(result).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return admin;
}

const input = { churchId: "church-qa", groupId: "group-qa", eventId: event.id };

test("a failed roster read cannot become an empty attendance form", async () => {
  const admin = mockClient({ group_memberships: { error: new Error("read failed") } });
  await assert.rejects(getAttendanceSheet(admin, input), /complete attendance sheet/);
});

test("a truncated roster cannot silently mark unseen people absent", async () => {
  const admin = mockClient({ group_memberships: { count: 1001 } });
  await assert.rejects(getAttendanceSheet(admin, input), /more people than the attendance form can safely show/);
});

test("a failed or truncated attendance fact read cannot hide counted people", async () => {
  await assert.rejects(getAttendanceSheet(mockClient({ attendance_facts: { error: new Error("read failed") } }), input), /complete attendance sheet/);
  await assert.rejects(getAttendanceSheet(mockClient({ attendance_facts: { count: 1 } }), input), /more attendance records than the form can safely show/);
});

test("a missing People label cannot leave an ambiguous attendee checkbox", async () => {
  const admin = mockClient({
    group_memberships: { data: [{ id: "membership-qa", member_id: "member-qa", account_id: null, group_role: "member" }], count: 1 },
  });
  await assert.rejects(getAttendanceSheet(admin, input), /complete attendance sheet/);
});

test("a complete empty roster is a valid attendance sheet", async () => {
  const sheet = await getAttendanceSheet(mockClient(), input);
  assert.equal(sheet.entries.length, 0);
  assert.equal(sheet.canRecord, true);
});

test("a membership that leaves before save cannot be silently marked absent", async () => {
  const selectedId = "11111111-1111-4111-8111-111111111111";
  let recorded = false;
  const admin = {
    from(table: string) {
      const result = table === "group_events"
        ? { data: { id: event.id }, error: null }
        : { data: [], error: null };
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
    },
    async rpc() { recorded = true; return { data: [{ outcome: "recorded", rejected_member_ids: [] }], error: null }; },
  } as unknown as SupabaseClient;
  await assert.rejects(submitAttendance(admin, {
    ...input,
    actor: { type: "staff", userId: "staff-qa" },
    idempotencyKey: "qa-save",
    values: { presentMembershipIds: [selectedId], guestCount: 0, firstTimeGuestCount: 0 },
  }), /roster changed/);
  assert.equal(recorded, false);
});
