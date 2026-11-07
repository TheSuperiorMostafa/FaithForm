import assert from "node:assert/strict";
import test from "node:test";
import { MEMBERSHIP_STATUSES, isMembershipStatus } from "@/lib/people/membership-status";
import { filterPeople } from "@/components/people/people-format";

test("every church status filters people and combines with the existing search", () => {
  const members = MEMBERSHIP_STATUSES.map(({ value }, i) => ({
    id: String(i), first_name: "Ann", last_name: value, phone: null, email: null,
    is_active: true, membership_status: value,
  }));
  const base = { search: "", filter: "all" as const, sortBy: "last-name" as const, isOnApp: () => false };
  for (const { value } of MEMBERSHIP_STATUSES) {
    assert.deepEqual(filterPeople(members, { ...base, membershipStatus: value }).map(person => person.membership_status), [value]);
    assert.deepEqual(filterPeople(members, { ...base, search: "nobody", membershipStatus: value }), []);
  }
  assert.equal(filterPeople(members, { ...base, membershipStatus: "all" }).length, 6);
});

test("legacy people are Unknown and statuses never infer identity or activity", () => {
  const member = { id: "legacy", first_name: "Ann", last_name: "Lee", phone: null, email: null, is_active: true };
  const base = { search: "", filter: "all" as const, sortBy: "last-name" as const, isOnApp: () => true };
  assert.deepEqual(filterPeople([member], { ...base, membershipStatus: "unknown" }), [member]);
  assert.deepEqual(filterPeople([member], { ...base, membershipStatus: "member" }), []);
  assert.equal(isMembershipStatus("admin"), false);
  assert.equal(isMembershipStatus(null), false);
  assert.equal(isMembershipStatus("regular_attender"), true);
});
