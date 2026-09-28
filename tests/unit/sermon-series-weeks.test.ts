import assert from "node:assert/strict";
import test from "node:test";

import { groupSeriesSermons } from "@/lib/sermon-builder/series-weeks";

const weeks = [
  { week: 1, title: "The Heart of God's Love", scripture: "John 3:16-17", themes: [] },
  { week: 2, title: "Sent to Save", scripture: "John 3:17", themes: [] },
];

function sermon(id: string, overrides: Partial<{
  title: string;
  scripture_refs: string[];
  series_week: number | null;
}> = {}) {
  return {
    id,
    title: overrides.title ?? "Changed title",
    scripture_refs: overrides.scripture_refs ?? ["John 3:16-17"],
    series_week: overrides.series_week ?? null,
    created_at: "2026-09-27T18:00:00Z",
  };
}

test("a saved week stays linked after its sermon title changes", () => {
  const grouped = groupSeriesSermons(weeks, [sermon("draft", { series_week: 1 })]);
  assert.deepEqual(grouped.byWeek.get(1)?.map((row) => row.id), ["draft"]);
  assert.deepEqual(grouped.other, []);
});

test("a legacy sermon without a week finds one unambiguous planned week", () => {
  const grouped = groupSeriesSermons(weeks, [
    sermon("qa", { title: "The Heart of God's Love" }),
    sermon("second", { title: "Retitled", scripture_refs: ["John 3:17"] }),
  ]);
  assert.deepEqual(grouped.byWeek.get(1)?.map((row) => row.id), ["qa"]);
  assert.deepEqual(grouped.byWeek.get(2)?.map((row) => row.id), ["second"]);
});

test("ambiguous or removed weeks stay visible without claiming a match", () => {
  const repeated = [weeks[0], { ...weeks[0], week: 3 }];
  const grouped = groupSeriesSermons(repeated, [
    sermon("ambiguous", { title: weeks[0].title }),
    sermon("removed", { series_week: 7 }),
  ]);
  assert.deepEqual(grouped.other.map((row) => row.id), ["ambiguous", "removed"]);
});
