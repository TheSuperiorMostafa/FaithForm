import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { creditAttendanceReports } from "@/lib/activity/attendance-report-credits";
import { logAnnouncementCredit, logFollowUpSendCredits } from "@/lib/activity/credits";
import { computeHoursSavedFromSources } from "@/lib/reports/hours-saved";
import { phoneCallMinutesSaved, phoneCallTaskName } from "@/lib/utils/phone-call-time-saved";

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for logActivity and creditAttendanceReports. */
function fakeClient(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let countRequested = false;
    const rows = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const result = () => {
      const matched = rows();
      return countRequested ? { data: null, count: matched.length, error: null } : { data: matched, error: null };
    };
    const builder = {
      select(_columns: string, options?: { count?: string }) {
        countRequested = Boolean(options?.count);
        return builder;
      },
      eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder; },
      in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder; },
      gte(column: string, value: string) { filters.push((row) => String(row[column]) >= value); return builder; },
      lt(column: string, value: string) { filters.push((row) => String(row[column]) < value); return builder; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: async (row: Row) => {
        (tables[table] ??= []).push({ id: `row-${(tables[table] ?? []).length + 1}`, ...row });
        return { error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

test("phone call minutes are the call length rounded up plus 5", () => {
  assert.equal(phoneCallMinutesSaved(null), 5);
  assert.equal(phoneCallMinutesSaved(0), 5);
  assert.equal(phoneCallMinutesSaved(1), 6);
  assert.equal(phoneCallMinutesSaved(60), 6);
  assert.equal(phoneCallMinutesSaved(61), 7);
  assert.equal(phoneCallMinutesSaved(600), 15);
  assert.equal(phoneCallTaskName("+15025550100", 61), "AI answered call from +15025550100 (7 min saved)");
});

test("announcement credits use one trigger source per channel per announcement", async () => {
  const tables: Record<string, Row[]> = { activity_log: [] };
  const client = fakeClient(tables);
  for (const channel of ["publish", "app", "facebook", "email"] as const) {
    await logAnnouncementCredit(channel, "church-1", "ann-1", "Fall Festival", client);
  }
  // Publishing the same announcement again, or to the same channel, earns nothing new.
  await logAnnouncementCredit("publish", "church-1", "ann-1", "Fall Festival", client);
  await logAnnouncementCredit("facebook", "church-1", "ann-1", "Fall Festival", client);
  // A second announcement is its own credit.
  await logAnnouncementCredit("publish", "church-1", "ann-2", "Bake Sale", client);

  const credits = tables.activity_log.map((r) => [r.trigger_source, r.automation_type, r.time_saved_minutes]);
  assert.deepEqual(credits, [
    ["announcement_publish:ann-1", "Publish Announcement", 5],
    ["announcement_app:ann-1", "Church App Updated", 8],
    ["announcement_facebook:ann-1", "Facebook Post about Announcement", 20],
    ["announcement_email:ann-1", "Announcement Email", 20],
    ["announcement_publish:ann-2", "Publish Announcement", 5],
  ]);
});

test("each follow-up send earns 60 minutes, plus 15 or 22 per person by Sundays missed", async () => {
  const tables: Record<string, Row[]> = { activity_log: [] };
  const client = fakeClient(tables);
  const texted = [
    { entryId: "e1", consecutiveAbsent: 1 },
    { entryId: "e2", consecutiveAbsent: 2 },
    { entryId: "e3", consecutiveAbsent: 3 },
    { entryId: "e4", consecutiveAbsent: 4 },
    { entryId: "e5", consecutiveAbsent: 7 },
  ];
  await logFollowUpSendCredits({ churchId: "church-1", serviceDate: "2026-11-22", sent: 5, texted }, client);

  const byType = (rows: Row[], type: string) => rows.filter((r) => r.automation_type === type);
  const pastoral = byType(tables.activity_log, "Personalized Pastoral Follow-up");
  assert.equal(pastoral.length, 1);
  assert.equal(pastoral[0].time_saved_minutes, 60);
  assert.match(String(pastoral[0].trigger_source), /^pastoral_follow_up:2026-11-22:[0-9a-f-]{36}$/);
  assert.deepEqual(
    byType(tables.activity_log, "Missed 2 weeks in a row notification").map((r) => [r.trigger_source, r.time_saved_minutes]),
    [["missed_2_weeks:e2", 15], ["missed_2_weeks:e3", 15]],
  );
  assert.deepEqual(
    byType(tables.activity_log, "Missed 4 weeks in a row notification").map((r) => [r.trigger_source, r.time_saved_minutes]),
    [["missed_4_weeks:e4", 22], ["missed_4_weeks:e5", 22]],
  );

  // A second press is another 60, but people already credited are not credited again.
  await logFollowUpSendCredits({ churchId: "church-1", serviceDate: "2026-11-22", sent: 2, texted: texted.slice(1, 3) }, client);
  assert.equal(byType(tables.activity_log, "Personalized Pastoral Follow-up").length, 2);
  assert.equal(tables.activity_log.length, 6);

  // Nothing sent, nothing credited.
  await logFollowUpSendCredits({ churchId: "church-1", serviceDate: "2026-11-29", sent: 0, texted: [] }, client);
  assert.equal(tables.activity_log.length, 6);
});

test("attendance reports are credited once per period, and only with attendance in that period", async () => {
  const tables: Record<string, Row[]> = {
    churches: [
      { id: "with-attendance", timezone: "America/New_York" },
      { id: "no-october-attendance", timezone: "America/New_York" },
    ],
    activity_log: [],
    attendance_records: [
      { id: "r1", church_id: "with-attendance", service_date: "2026-10-04" },
      { id: "r2", church_id: "with-attendance", service_date: "2026-10-11" },
      { id: "r3", church_id: "no-october-attendance", service_date: "2026-09-27" },
    ],
  };
  const client = fakeClient(tables);
  const novemberFirst = new Date("2026-11-01T15:00:00Z");

  assert.equal(await creditAttendanceReports(novemberFirst, client), 1);
  assert.deepEqual(
    tables.activity_log.map((r) => [r.church_id, r.automation_type, r.time_saved_minutes, r.trigger_source]),
    [["with-attendance", "Monthly Attendance Report", 25, "attendance_report:2026-10"]],
  );

  // Later cron runs the same day do not credit the period again.
  assert.equal(await creditAttendanceReports(new Date("2026-11-01T20:00:00Z"), client), 0);
  assert.equal(tables.activity_log.length, 1);

  // Not the 1st: nothing is due.
  assert.equal(await creditAttendanceReports(new Date("2026-11-02T15:00:00Z"), client), 0);
});

test("the first of January credits the month, the quarter, and the year", async () => {
  const tables: Record<string, Row[]> = {
    churches: [{ id: "c1", timezone: "America/Chicago" }],
    activity_log: [],
    attendance_records: [{ id: "r1", church_id: "c1", service_date: "2026-12-06" }],
  };
  assert.equal(await creditAttendanceReports(new Date("2027-01-01T18:00:00Z"), fakeClient(tables)), 3);
  assert.deepEqual(
    tables.activity_log.map((r) => [r.automation_type, r.time_saved_minutes, r.trigger_source]),
    [
      ["Monthly Attendance Report", 25, "attendance_report:2026-12"],
      ["Quarterly Attendance Report", 40, "attendance_report:2026-Q4"],
      ["Annual Attendance Report", 90, "attendance_report:2026"],
    ],
  );
});

test("hours saved counts each Sunday once and does not add its activity entry on top", () => {
  const result = computeHoursSavedFromSources({
    phoneCalls: [], announcements: [], assets: [], sermons: [],
    attendance: [
      { service_date: "2026-11-01", submitted_at: "2026-11-01T15:00:00Z" },
      { service_date: "2026-11-01", submitted_at: "2026-11-01T15:05:00Z" },
    ],
    activities: [
      { automation_type: "Track Weekly Attendance", category: "Admin", time_saved_minutes: 10, executed_at: "2026-11-01T15:00:00Z" },
      { automation_type: "Publish Announcement", category: "Communication", time_saved_minutes: 5, executed_at: "2026-11-02T12:00:00Z" },
      { automation_type: "Facebook Post about Announcement", category: "Social", time_saved_minutes: 20, executed_at: "2026-11-02T12:00:00Z" },
    ],
  }, { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") });
  assert.equal(result.automationMinutes.get("Track Weekly Attendance"), 10);
  assert.equal(result.minutes, 35);
  assert.equal(result.tasks, 3);
});
