import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getChurchDashboardUsageSummary,
  getUserDashboardUsageByChurch,
} from "@/lib/queries/dashboard-usage";

type Row = Record<string, string | number | null>;

function database(
  usage: Row[],
  activity: Row[],
  options: { failTable?: string; omitPhoneCount?: boolean } = {},
): SupabaseClient {
  return {
    from(table: string) {
      const source = table === "dashboard_usage_daily" ? usage : activity;
      const filters: ((row: Row) => boolean)[] = [];
      let countRequested = false;
      let head = false;
      let limit = 1000;
      const builder = {
        select(_columns: string, selectOptions?: { count?: string; head?: boolean }) {
          countRequested = selectOptions?.count === "exact";
          head = selectOptions?.head === true;
          return builder;
        },
        eq(column: string, value: string) {
          filters.push((row: Row) => row[column] === value);
          return builder;
        },
        gte(column: string, value: string) {
          filters.push((row: Row) => String(row[column]) >= value);
          return builder;
        },
        gt(column: string, value: string) {
          filters.push((row: Row) => String(row[column]) > value);
          return builder;
        },
        order() { return builder; },
        limit(value: number) {
          limit = value;
          return builder;
        },
        then(resolve: (result: {
          data: Row[] | null;
          error: { message: string } | null;
          count: number | null;
        }) => void) {
          if (options.failTable === table) {
            resolve({ data: null, error: { message: "read failed" }, count: null });
            return;
          }
          const rows = source.filter((row) => filters.every((filter) => filter(row)))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
          resolve({
            data: head ? null : rows.slice(0, limit),
            error: null,
            count: countRequested && !(head && options.omitPhoneCount) ? rows.length : null,
          });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const today = new Date().toISOString().slice(0, 10);
const usage = Array.from({ length: 1205 }, (_, index) => ({
  id: String(index).padStart(5, "0"),
  church_id: "church-a",
  user_id: index < 1200 ? "user-a" : "user-b",
  usage_date: today,
  active_seconds: 60,
  last_seen_at: index === 1199 ? "2026-09-28T12:00:00Z" : "2026-09-27T12:00:00Z",
}));
const activity = Array.from({ length: 1205 }, (_, index) => ({
  id: String(index).padStart(5, "0"),
  church_id: "church-a",
  executed_at: "2099-01-01T12:00:00Z",
  category: index < 40 ? "Phone" : "Other",
  time_saved_minutes: 2,
}));

test("church activity totals include every page", async () => {
  const summary = await getChurchDashboardUsageSummary(
    "church-a",
    database(usage, activity),
  );
  assert.deepEqual(summary, {
    hoursSavedMinutes30d: 1205 * 2,
    phoneCalls30d: 40,
  });
});

test("church member usage includes every page and only requested members", async () => {
  const users = await getUserDashboardUsageByChurch(
    "church-a",
    ["user-a"],
    database(usage, activity),
  );
  assert.equal(users.size, 1);
  assert.deepEqual(users.get("user-a"), {
    lastSeenAt: "2026-09-28T12:00:00Z",
  });
});

test("failed reads and missing call counts cannot appear as zero activity", async () => {
  await assert.rejects(
    getChurchDashboardUsageSummary("church-a", database(usage, activity, { failTable: "activity_log" })),
    /recent activity read failed/,
  );
  await assert.rejects(
    getChurchDashboardUsageSummary("church-a", database(usage, activity, { omitPhoneCount: true })),
    /phone call activity count unavailable/,
  );
  await assert.rejects(
    getUserDashboardUsageByChurch("church-a", ["user-a"], database(usage, activity, { failTable: "dashboard_usage_daily" })),
    /dashboard usage read failed/,
  );
});
