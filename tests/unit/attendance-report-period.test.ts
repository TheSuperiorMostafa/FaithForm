import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendancePeriod } from "@/lib/utils/reports";

test("attendance report ranges cover calendar months, quarters, and years", () => {
  assert.equal(parseAttendancePeriod("2024-02")?.endDateIso, "2024-03-01");
  assert.equal(parseAttendancePeriod("2026-Q1")?.startDateIso, "2026-01-01");
  assert.equal(parseAttendancePeriod("2026-Q1")?.endDateIso, "2026-04-01");
  assert.equal(parseAttendancePeriod("2026-Q4")?.endDateIso, "2027-01-01");
  assert.equal(parseAttendancePeriod("2026")?.startDateIso, "2026-01-01");
  assert.equal(parseAttendancePeriod("2026")?.endDateIso, "2027-01-01");
});

test("invalid report periods cannot create unbounded attendance ranges", () => {
  for (const value of ["2026-Q0", "2026-Q5", "2026-13", "2026-Q1-extra", "oops", "0000", "9999"]) {
    assert.equal(parseAttendancePeriod(value), null);
  }
});
