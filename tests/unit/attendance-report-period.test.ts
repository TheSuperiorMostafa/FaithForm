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

test("reports become available only when their calendar period has ended in the church timezone", async () => {
  const { isReportPeriodComplete } = await import("@/lib/utils/reports");
  const quarter = parseAttendancePeriod("2026-Q3")!;
  assert.equal(isReportPeriodComplete(quarter, new Date("2026-10-01T03:59:59Z"), "America/New_York"), false);
  assert.equal(isReportPeriodComplete(quarter, new Date("2026-10-01T04:00:00Z"), "America/New_York"), true);
  assert.equal(isReportPeriodComplete(parseAttendancePeriod("2026")!, new Date("2026-12-31T23:59:59Z")), false);
  assert.equal(isReportPeriodComplete(parseAttendancePeriod("2026-10")!, new Date("2026-10-20T12:00:00Z")), false);
});

test("quarter and annual attendance growth compare matching previous periods including recorded zero", async () => {
  const { buildAttendancePeriodGrowth } = await import("@/lib/reports/attendance-metrics");
  const rows = [
    { serviceDate: "2026-01-04", morningWorship: 0 },
    { serviceDate: "2026-02-01", morningWorship: 100 },
    { serviceDate: "2026-04-05", morningWorship: 75 },
    { serviceDate: "2026-05-03", morningWorship: 125 },
  ];
  assert.deepEqual(buildAttendancePeriodGrowth(rows, new Date(2026, 3, 1), new Date(2026, 6, 1)), { average: 100, previousAverage: 50, growthPct: 100 });
  const annual = buildAttendancePeriodGrowth([
    { serviceDate: "2025-03-02", morningWorship: 100 },
    { serviceDate: "2026-03-01", morningWorship: 90 },
  ], new Date(2026, 0, 1), new Date(2027, 0, 1));
  assert.equal(annual.growthPct, -10);
  assert.equal(buildAttendancePeriodGrowth([], new Date(2026, 0, 1), new Date(2027, 0, 1)).growthPct, null);
});

test("time saved comparison describes growth, declines, equal values, and zero baselines honestly", async () => {
  const { formatHoursComparison } = await import("@/lib/utils/reports");
  assert.match(formatHoursComparison(12, 10), /^Up from 10.00 hours last month \(\+20.00%\)/);
  assert.match(formatHoursComparison(8, 10), /^Down from 10.00 hours last month \(-20.00%\)/);
  assert.match(formatHoursComparison(10, 10), /^Unchanged/);
  assert.match(formatHoursComparison(10, 0), /unavailable with a zero baseline/);
});

test("report calendar lookup fails closed when the church timezone cannot be trusted", async () => {
  const { getReportTimeZone } = await import("@/lib/queries/library");
  const client = (result: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }) }) as unknown as Parameters<typeof getReportTimeZone>[0];
  await assert.rejects(getReportTimeZone(client({ data: null, error: { message: "unavailable" } }), "church"));
  await assert.rejects(getReportTimeZone(client({ data: { timezone: "invalid-zone" }, error: null }), "church"));
  assert.equal(await getReportTimeZone(client({ data: { timezone: null }, error: null }), "church"), "America/New_York");
  assert.equal(await getReportTimeZone(client({ data: { timezone: "America/Los_Angeles" }, error: null }), "church"), "America/Los_Angeles");
});
