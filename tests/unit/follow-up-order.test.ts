import assert from "node:assert/strict";
import test from "node:test";

import {
  hasFollowUpPhone,
  phoneNumbersFirst,
  sortFollowUpCandidates,
} from "@/lib/attendance/follow-up-order";

function person(name: string, phone: string | null, consecutiveAbsent = 1) {
  return { name, phone, consecutiveAbsent };
}

test("a blank or spaces-only phone counts as no phone", () => {
  assert.equal(hasFollowUpPhone({ phone: "+15555550100" }), true);
  assert.equal(hasFollowUpPhone({ phone: null }), false);
  assert.equal(hasFollowUpPhone({ phone: undefined }), false);
  assert.equal(hasFollowUpPhone({ phone: "" }), false);
  assert.equal(hasFollowUpPhone({ phone: "   " }), false);
});

test("people with a phone number move above people without, keeping their order", () => {
  const list = [
    person("Ann", null),
    person("Ben", "555-0101"),
    person("Cal", "  "),
    person("Dee", "555-0102"),
    person("Eve", null),
    person("Fay", "555-0103"),
  ];
  assert.deepEqual(
    phoneNumbersFirst(list).map((p) => p.name),
    ["Ben", "Dee", "Fay", "Ann", "Cal", "Eve"],
  );
  // The input is left alone.
  assert.equal(list[0].name, "Ann");
});

test("follow-up order: phone first, then longest streak, then name", () => {
  const sorted = sortFollowUpCandidates([
    person("Zoe", null, 6),
    person("Amy", "555-0101", 1),
    person("Bob", "555-0102", 3),
    person("Cy", null, 2),
    person("Abe", "555-0103", 3),
    person("Al", null, 2),
  ]);
  assert.deepEqual(
    sorted.map((p) => p.name),
    ["Abe", "Bob", "Amy", "Zoe", "Al", "Cy"],
  );
});

test("everyone without a phone still keeps streak-then-name order", () => {
  const sorted = sortFollowUpCandidates([
    person("Bea", null, 1),
    person("Ann", null, 1),
    person("Cid", null, 4),
  ]);
  assert.deepEqual(sorted.map((p) => p.name), ["Cid", "Ann", "Bea"]);
});
