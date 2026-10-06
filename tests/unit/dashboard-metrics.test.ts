import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dashboardMetricsFromSources, getDashboardMetrics } from "../../lib/queries/dashboard";
import { computeHoursSaved, type HoursSavedSources } from "../../lib/reports/hours-saved";

const now = new Date("2026-10-06T12:00:00Z");
const sources: HoursSavedSources = {
  phoneCalls: ["2026-10-05", "2026-09-25", "2026-09-10", "2026-08-01"].map((day) => ({
    called_at: `${day}T12:00:00Z`, duration_seconds: 60, call_type: "inbound",
  })),
  announcements: [{ created_at: "2026-10-04T12:00:00Z", push_to_facebook: true, push_to_team: true }],
  attendance: [{ service_date: "2026-10-04", submitted_at: "2026-10-04T12:00:00Z" }],
  assets: [{ kind: "pptx", created_at: "2026-09-25T12:00:00Z", sermons: { church_id: "church-a" } }],
  sermons: [{ created_at: "2026-10-03T12:00:00Z", outline_generated_at: null, content_generated_at: null, published_at: null, status: "draft" }],
  activities: [{ automation_type: "Custom task", category: "Admin", time_saved_minutes: 15, executed_at: "2026-08-01T12:00:00Z" }],
};
const tables = {
  phone_calls: sources.phoneCalls, announcements: sources.announcements,
  attendance_records: sources.attendance, sermon_assets: sources.assets,
  sermons: sources.sermons, activity_log: sources.activities,
};
function clientFor(rows = tables) {
  const reads: string[] = [];
  const scopes: [string, unknown][] = [];
  const client = {
    from(table: keyof typeof tables) {
      let start = 0;
      let end = Infinity;
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { scopes.push([column, value]); return query; },
        lte() { return query; }, gte() { return query; }, order() { return query; },
        range(first: number, last: number) { start = first; end = last; return query; },
        then(resolve: (result: unknown) => unknown) {
          reads.push(table);
          return Promise.resolve({ data: rows[table].slice(start, end + 1), error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, reads, scopes };
}

test("one church-scoped snapshot supplies all three ranges in six reads", async () => {
  const { client, reads, scopes } = clientFor();
  const metrics = await getDashboardMetrics(client, "church-a");
  assert.equal(reads.length, 6);
  assert.equal(scopes.length, 6);
  assert.ok(scopes.every(([column, church]) => column.endsWith("church_id") && church === "church-a"));
  assert.deepEqual(Object.keys(metrics), ["week", "month", "all"]);
});

test("shared calculations retain existing hours, categories, and comparisons for each window", async () => {
  const metrics = dashboardMetricsFromSources(sources, now);
  for (const [range, days] of [["week", 7], ["month", 30], ["all", null]] as const) {
    const start = days ? new Date(now.getTime() - days * 86400000) : null;
    const current = await computeHoursSaved(clientFor().client, "church-a", { start, end: now });
    assert.equal(metrics[range].hours.totalMinutes, current.minutes);
    assert.equal(metrics[range].hours.taskCount, current.tasks);
    assert.deepEqual(metrics[range].hours.byCategory, current.byCategory);
    if (start && days) {
      const prior = await computeHoursSaved(clientFor().client, "church-a", {
        start: new Date(start.getTime() - days * 86400000), end: start,
      });
      const expected = prior.minutes === 0 ? (current.minutes === 0 ? 0 : 100)
        : Math.round((current.minutes - prior.minutes) / prior.minutes * 100);
      assert.equal(metrics[range].hours.deltaPercent, expected);
    } else assert.equal(metrics[range].hours.deltaPercent, null);
  }
  assert.equal(metrics.week.stats.phoneCalls.value, 1);
  assert.equal(metrics.month.stats.phoneCalls.value, 3);
  assert.equal(metrics.all.stats.phoneCalls.value, 4);
  assert.equal(metrics.week.stats.pptxCreated.value, 0);
  assert.equal(metrics.month.stats.pptxCreated.value, 1);
  assert.equal(metrics.all.stats.phoneCalls.deltaPercent, null);
});

test("dashboard totals include records beyond the database page limit", async () => {
  const rows = { ...tables, phone_calls: Array.from({ length: 1001 }, () => sources.phoneCalls[0]) };
  const { client, reads } = clientFor(rows);
  const metrics = await getDashboardMetrics(client, "church-a");
  assert.equal(metrics.all.stats.phoneCalls.value, 1001);
  assert.equal(reads.filter((table) => table === "phone_calls").length, 2);
});

test("aggregate phone reads retain their dedicated client and church scope", async () => {
  const session = clientFor();
  const aggregate = clientFor();
  await getDashboardMetrics(session.client, "church-a", aggregate.client);
  assert.deepEqual(aggregate.reads, ["phone_calls"]);
  assert.equal(session.reads.length, 5);
  assert.ok(!session.reads.includes("phone_calls"));
  assert.deepEqual(aggregate.scopes, [["church_id", "church-a"]]);
});
