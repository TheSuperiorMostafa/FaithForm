import assert from "node:assert/strict";
import test from "node:test";

import { churchServiceStartIso } from "@/lib/stream/schedule-time";

test("a service starts at the church's time even when the viewer is elsewhere", () => {
  assert.equal(
    churchServiceStartIso("2026-09-30T10:00", "America/New_York"),
    "2026-09-30T14:00:00.000Z",
  );
  assert.equal(
    churchServiceStartIso("2026-09-30T10:00", "America/Los_Angeles"),
    "2026-09-30T17:00:00.000Z",
  );
});

test("a nonexistent local time during daylight saving transition is refused", () => {
  assert.equal(churchServiceStartIso("2026-03-08T02:30", "America/New_York"), null);
  assert.equal(churchServiceStartIso("2026-09-30T10", "America/New_York"), null);
});
