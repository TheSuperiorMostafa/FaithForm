import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listStandaloneEmailRows } from "@/lib/announcements/weekly-email";
import {
  getPublishedAnnouncements,
  getPublishedAnnouncementsByGoogleId,
} from "@/lib/queries/announcements";

type Row = Record<string, unknown> & { id: string };

function fakeAnnouncements(
  rows: Row[],
  options: { failAfterId?: string; oldSchema?: boolean } = {},
): SupabaseClient {
  return {
    from: () => ({
      select: (columns: string, selectOptions?: { count?: string }) => {
        const filters: Array<(row: Row) => boolean> = [];
        let afterId: string | null = null;
        let limit = Number.POSITIVE_INFINITY;
        const query = {
          eq(column: string, value: unknown) {
            filters.push((row: Row) => row[column] === value);
            return query;
          },
          not(column: string) {
            filters.push((row: Row) => row[column] != null);
            return query;
          },
          is(column: string, value: null) {
            filters.push((row: Row) => row[column] === value);
            return query;
          },
          order() { return query; },
          limit(value: number) { limit = value; return query; },
          gt(column: string, value: string) {
            assert.equal(column, "id");
            afterId = value;
            return query;
          },
          then(resolve: (page: unknown) => unknown) {
            if (options.oldSchema && columns.includes("all_day")) {
              return Promise.resolve(resolve({
                data: null,
                error: { message: "column all_day does not exist" },
                count: null,
              }));
            }
            if (afterId && options.failAfterId === afterId) {
              return Promise.resolve(resolve({
                data: null,
                error: { message: "later page unavailable" },
                count: null,
              }));
            }
            const matched = rows.filter((row) => filters.every((filter) => filter(row)));
            const data = matched
              .filter((row) => !afterId || row.id > afterId)
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, limit);
            return Promise.resolve(resolve({
              data,
              error: null,
              count: selectOptions?.count === "exact" ? matched.length : null,
            }));
          },
        };
        return query;
      },
    }),
  } as unknown as SupabaseClient;
}

const id = (i: number) => `id-${String(i).padStart(4, "0")}`;
const calendarRows = Array.from({ length: 1001 }, (_, i) => ({
  id: id(i),
  church_id: "church",
  status: "published",
  google_event_id: `google-${i}`,
  title: `Event ${i}`,
  start_at: "2026-10-01T12:00:00.000Z",
  published_at: "2026-09-27T12:00:00.000Z",
}));

test("published announcements and calendar linkage include row 1001", async () => {
  const client = fakeAnnouncements(calendarRows);
  const [published, byGoogleId] = await Promise.all([
    getPublishedAnnouncements(client, "church"),
    getPublishedAnnouncementsByGoogleId(client, "church"),
  ]);

  assert.equal(published.length, 1001);
  assert.equal(published.some((row) => row.id === id(1000)), true);
  assert.equal(Object.keys(byGoogleId).length, 1001);
  assert.equal(byGoogleId["google-1000"], id(1000));
});

test("a later published page failure cannot look like an empty list", async () => {
  const client = fakeAnnouncements(calendarRows, { failAfterId: id(499) });
  await assert.rejects(
    getPublishedAnnouncements(client, "church"),
    /published announcements read failed/,
  );
  await assert.rejects(
    getPublishedAnnouncementsByGoogleId(client, "church"),
    /published calendar announcements read failed/,
  );
});

test("weekly standalone announcements read every page with older schema fallback", async () => {
  const standaloneRows = calendarRows.map((row) => ({
    ...row,
    google_event_id: null,
    push_to_team: true,
    event_date: null,
    body: "Test body",
  }));
  const rows = await listStandaloneEmailRows(
    "church",
    fakeAnnouncements(standaloneRows, { oldSchema: true }),
  );
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1)?.title, "Event 1000");
  assert.equal(rows.at(-1)?.undated, true);

  await assert.rejects(
    listStandaloneEmailRows(
      "church",
      fakeAnnouncements(standaloneRows, { failAfterId: id(499), oldSchema: true }),
    ),
    /Weekly announcements read failed/,
  );
});
