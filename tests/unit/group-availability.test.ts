import assert from "node:assert/strict";
import test from "node:test";
import { readOrSaveAvailability } from "@/lib/groups/availability";
import { groupAvailabilitySchema } from "@/lib/mobile/v1/contract";

const scope = { churchId: "church", groupId: "team", membershipId: "ordinary-member", groupStatus: "active" };
function database() {
  const filters: Record<string, unknown> = {};
  let saved: unknown;
  let data: { availability: string } | null = { availability: "Sundays" };
  let error: unknown = null;
  const chain = {
    select() { return chain; },
    update(value: unknown) { saved = value; return chain; },
    eq(key: string, value: unknown) { filters[key] = value; return chain; },
    maybeSingle: async () => ({ data, error }),
  };
  return { filters, get saved() { return saved; }, missing() { data = null; }, fail() { error = { message: "unavailable" }; }, client: { from: () => chain } as never };
}

test("ordinary members save their own availability with church, group and active membership scope", async () => {
  const db = database();
  assert.deepEqual(await readOrSaveAvailability(db.client, scope, " Sunday mornings "), { availability: "Sundays" });
  assert.deepEqual(db.saved, { availability: "Sunday mornings" });
  assert.deepEqual(db.filters, { id: "ordinary-member", church_id: "church", group_id: "team", status: "active" });
});
test("nonmembers and archived teams cannot write; oversized notes fail before the database", async () => {
  const db = database();
  await assert.rejects(readOrSaveAvailability(db.client, { ...scope, membershipId: null }, "Sundays"), /Join the group/);
  await assert.rejects(readOrSaveAvailability(db.client, { ...scope, groupStatus: "archived" }, "Sundays"), /Restore this group/);
  await assert.rejects(readOrSaveAvailability(db.client, scope, "a".repeat(501)), /500 characters/);
  assert.equal(db.saved, undefined);
});
test("clearing availability is allowed and stale memberships never claim success", async () => {
  const db = database();
  await readOrSaveAvailability(db.client, scope, "   ");
  assert.deepEqual(db.saved, { availability: "" });
  db.missing();
  await assert.rejects(readOrSaveAvailability(db.client, scope, "Sundays"), /membership has changed/);
});
test("read failures are retryable and request bodies cannot choose another member", async () => {
  const db = database(); db.fail();
  await assert.rejects(readOrSaveAvailability(db.client, scope), /Could not load/);
  assert.deepEqual(groupAvailabilitySchema.parse({ availability: "Sundays", membershipId: "someone-else" }), { availability: "Sundays" });
  assert.equal(groupAvailabilitySchema.safeParse({ availability: "a".repeat(501) }).success, false);
});
