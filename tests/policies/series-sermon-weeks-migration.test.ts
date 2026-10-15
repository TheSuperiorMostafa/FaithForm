import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/0132_series_sermon_weeks.sql", "utf8");
test("legacy linking preserves existing week links and the existing range", () => {
  assert.doesNotMatch(sql, /CREATE UNIQUE INDEX|ADD CONSTRAINT/i);
  assert.match(sql, /BETWEEN 1 AND 52/);
  assert.match(sql, /s\.series_week IS NULL/);
});
test("legacy linking requires same church and unambiguous matches in both directions", () => {
  assert.match(sql, /sr\.id = s\.series_id AND sr\.church_id = s\.church_id/);
  assert.match(sql, /c\.sermon_matches = 1 AND c\.week_matches = 1/);
  assert.match(sql, /linked\.series_id = c\.series_id AND linked\.series_week = c\.week/);
});
test("saving a planned week checks owned series membership and its valid plan", () => {
  const route = readFileSync("app/api/sermon/simple/route.ts", "utf8");
  assert.match(route, /\.eq\("church_id", churchId\)/);
  assert.match(route, /!isValidSeriesWeek\(seriesWeek, data\.plan as SeriesPlan \| null\)/);
  assert.match(route, /ownSeriesWeek\(auth\.churchId, body\.series_id, body\.series_week\)/);
});
test("series display query scopes both series and tenant and reports database errors", () => {
  const queries = readFileSync("lib/queries/sermons.ts", "utf8");
  const query = queries.slice(queries.indexOf("export async function listSeriesSermons"), queries.indexOf("export async function createSeries"));
  assert.match(query, /\.eq\("church_id", churchId\)/);
  assert.match(query, /\.eq\("series_id", seriesId\)/);
  assert.match(query, /readAllById<SeriesSermonItem>/);
  assert.match(query, /error, count/);
});
