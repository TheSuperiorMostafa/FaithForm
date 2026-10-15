import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { kidsCheckInDataSchema } from "@/lib/mobile/v1/contract";

test("private household response preserves leading-zero pickup codes and room alerts", () => {
  const fixture = JSON.parse(readFileSync("contracts/faithform/v1/fixtures/kids-checkin-household.json", "utf8"));
  const data = kidsCheckInDataSchema.parse(fixture.data);
  assert.equal(data.households[0].pickupCode, "012345");
  assert.equal(data.households[0].alerts[0].roomName, "Nursery");
});

test("non-guardians have an explicit empty household collection", () => {
  assert.deepEqual(kidsCheckInDataSchema.parse({ households: [] }), { households: [] });
});

test("missing household code or malformed alerts fail decoding", () => {
  assert.equal(kidsCheckInDataSchema.safeParse({ households: [{ id: "h", label: "Family", children: [], alerts: [] }] }).success, false);
  assert.equal(kidsCheckInDataSchema.safeParse({ households: [{ id: "h", label: "Family", pickupCode: "012345", children: [], alerts: [{}] }] }).success, false);
});
