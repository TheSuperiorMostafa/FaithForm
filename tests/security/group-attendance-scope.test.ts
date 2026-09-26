import assert from "node:assert/strict";
import test from "node:test";

import { submitAttendance } from "@/lib/groups/gatherings";

/**
 * `record_group_attendance` finds the gathering by church alone and then
 * rewrites that gathering's attendance, reversing everyone not listed. A
 * leader of group A who named group B's gathering id therefore wiped B's
 * attendance; and a roster read that failed became "nobody came", which wiped
 * the leader's own. Both must stop before the command runs.
 */

const CHURCH = "11111111-1111-4111-8111-111111111111";
const GROUP_A = "aaaaaaaa-0000-4000-8000-000000000001";
const GROUP_B = "bbbbbbbb-0000-4000-8000-000000000002";
const EVENT_B = "eeeeeeee-0000-4000-8000-00000000000b";

function fakeAdmin(options: { rosterError?: boolean } = {}) {
  const rpcCalls: string[] = [];
  const admin = {
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return { data: [{ outcome: "recorded", rejected_member_ids: [] }], error: null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        in: async () =>
          options.rosterError
            ? { data: null, error: { message: "timeout" } }
            : { data: [], error: null },
        maybeSingle: async () => ({
          data:
            table === "group_events" &&
            filters.id === EVENT_B &&
            filters.group_id === GROUP_B &&
            filters.church_id === CHURCH
              ? { id: EVENT_B }
              : null,
          error: null,
        }),
      };
      return builder;
    },
  };
  return { admin: admin as never, rpcCalls };
}

const values = { presentMembershipIds: [], guestCount: 0, firstTimeGuestCount: 0 };

test("a leader of one group cannot record attendance on another group's gathering", async () => {
  const { admin, rpcCalls } = fakeAdmin();
  await assert.rejects(
    submitAttendance(admin, {
      churchId: CHURCH,
      groupId: GROUP_A,
      eventId: EVENT_B,
      actor: { type: "leader", userId: "user-1" },
      idempotencyKey: "key-12345678",
      values,
    }),
    /That gathering was not found/,
  );
  assert.deepEqual(rpcCalls, [], "the attendance command must not run");
});

test("the gathering's own group still records", async () => {
  const { admin, rpcCalls } = fakeAdmin();
  const result = await submitAttendance(admin, {
    churchId: CHURCH,
    groupId: GROUP_B,
    eventId: EVENT_B,
    actor: { type: "leader", userId: "user-1" },
    idempotencyKey: "key-12345678",
    values,
  });
  assert.equal(result.outcome, "recorded");
  assert.deepEqual(rpcCalls, ["record_group_attendance"]);
});

test("a roster that could not be read is not taken to mean nobody came", async () => {
  const { admin, rpcCalls } = fakeAdmin({ rosterError: true });
  await assert.rejects(
    submitAttendance(admin, {
      churchId: CHURCH,
      groupId: GROUP_B,
      eventId: EVENT_B,
      actor: { type: "leader", userId: "user-1" },
      idempotencyKey: "key-12345678",
      values: { ...values, presentMembershipIds: ["cccccccc-0000-4000-8000-000000000001"] },
    }),
    /Could not save attendance/,
  );
  assert.deepEqual(rpcCalls, []);
});
