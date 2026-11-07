import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canConfigureService } from "@/lib/attendance/service-controls";

const now = Date.parse("2026-11-06T14:00:00Z");
test("recent, completed and cancelled services hide live setup controls", () => {
  assert.equal(canConfigureService({ status: "scheduled", checkinClosesAtUtc: "2026-11-06T13:59:59Z" }, now), false);
  assert.equal(canConfigureService({ status: "active", checkinClosesAtUtc: "2026-11-06T14:00:00Z" }, now), false);
  for (const status of ["completed", "cancelled"] as const) {
    assert.equal(canConfigureService({ status, checkinClosesAtUtc: "2026-11-06T15:00:00Z" }, now), false);
  }
  for (const status of ["scheduled", "active"] as const) {
    assert.equal(canConfigureService({ status, checkinClosesAtUtc: "2026-11-06T15:00:00Z" }, now), true);
  }
  assert.equal(canConfigureService({ status: "active", checkinClosesAtUtc: "invalid" }, now), false);
});

test("recent board hides cancellation and screen/desk setup while keeping attendance", () => {
  const board = readFileSync("components/attendance/service-occurrences-board.tsx", "utf8");
  assert.match(board, /isAdmin && configurable &&/);
  assert.match(board, /configurable && \(\s*<AdvancedSection/);
  assert.match(board, /Open Sunday count/);
});
