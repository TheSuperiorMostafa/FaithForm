import assert from "node:assert/strict";
import test from "node:test";

import { isoToZonedInput, zonedInputToIso } from "@/lib/utils/zoned-datetime-input";

test("a meeting's wall time follows its named zone, not the editor's computer", () => {
  const wallTime = "2026-09-30T18:00";
  const instant = zonedInputToIso(wallTime, "America/New_York");
  assert.equal(instant, "2026-09-30T22:00:00.000Z");
  assert.equal(isoToZonedInput(instant!, "America/New_York"), wallTime);
  assert.equal(isoToZonedInput(instant!, "America/Los_Angeles"), "2026-09-30T15:00");
});

test("an old meeting keeps its original instant when reopened in its own zone", () => {
  const instant = "2026-09-30T22:00:00.000Z";
  const oldZone = "America/Los_Angeles";
  assert.equal(zonedInputToIso(isoToZonedInput(instant, oldZone)!, oldZone), instant);
});

test("invalid and nonexistent wall times cannot be saved", () => {
  assert.equal(zonedInputToIso("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(zonedInputToIso("2026-09-30T18", "America/New_York"), null);
  assert.equal(isoToZonedInput("not-an-instant", "America/New_York"), null);
});
