import assert from "node:assert/strict";
import test from "node:test";
import { isValidSeriesWeek } from "@/lib/sermon-builder/series-week";

const plan = { weeks: [{ week: 2, title: "Grace", scripture: "John 3:16", themes: [] }] };
test("series links accept only a positive integer belonging to the owned plan", () => {
  assert.equal(isValidSeriesWeek(2, plan), true);
  for (const week of [0, -1, 1, 2.5, "2", null, undefined, Infinity]) {
    assert.equal(isValidSeriesWeek(week, plan), false);
  }
  assert.equal(isValidSeriesWeek(2, null), false);
});
test("series weeks remain within the existing database range", () => {
  const outside = { weeks: [{ week: 53, title: "Extra", scripture: "", themes: [] }] };
  assert.equal(isValidSeriesWeek(53, outside), false);
});
