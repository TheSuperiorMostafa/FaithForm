import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const FILE = "supabase/migrations/0079_mobile_announcement_schedule.sql";
const sql = readFileSync(FILE, "utf8");
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const schedule = executable.slice(
  executable.indexOf("create or replace function public.mobile_announcement_schedule"),
  executable.indexOf("create or replace function public.mobile_announcement_feed"),
);

test("0079 has a unique prefix", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.startsWith("0079"));
  assert.deepEqual(files, ["0079_mobile_announcement_schedule.sql"]);
});

test("schedule: overlaps the requested window instead of hiding past events", () => {
  assert.match(schedule, /v\.effective_start < p_to/);
  assert.match(schedule, /v\.effective_end > p_from/);
  assert.doesNotMatch(schedule, /\) > p_now/);
});

test("schedule: publication, withdrawal and targeting still gate every row", () => {
  assert.match(schedule, /status = 'published'/);
  assert.match(schedule, /is_ready/);
  assert.match(schedule, /mobile_unpublished_at is null/);
  assert.match(schedule, /mobile_visibility <> 'none'/);
  assert.match(schedule, /coalesce\(\w\.mobile_published_at, \w\.published_at, p_now\) <= p_now/);
  assert.match(schedule, /'followers'[\s\S]{0,80}p_relationship_state in \('following', 'joined'\)/);
  assert.match(schedule, /'members'[\s\S]{0,80}p_relationship_state = 'joined'/);
});

test("schedule: returns all_day and orders soonest first", () => {
  assert.match(schedule, /coalesce\(v\.all_day, false\) as all_day/);
  assert.match(schedule, /order by v\.effective_start asc, v\.id asc/);
});

test("schedule: callable by the service role only", () => {
  assert.match(
    sql,
    /revoke all on function\s+public\.mobile_announcement_schedule\([^)]*\)\s+from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function\s+public\.mobile_announcement_schedule\([^)]*\)\s+to service_role/,
  );
});

test("feed and detail: drop before recreate when OUT columns change", () => {
  assert.match(
    executable,
    /drop function if exists\s+public\.mobile_announcement_feed\(text, text, boolean, timestamptz, uuid, integer, timestamptz\)/,
  );
  assert.match(
    executable,
    /drop function if exists\s+public\.mobile_announcement_detail\(text, uuid, text, timestamptz\)/,
  );
});

test("feed and detail: expose all_day", () => {
  const feed = executable.slice(
    executable.indexOf("create or replace function public.mobile_announcement_feed"),
    executable.indexOf("create or replace function public.mobile_announcement_detail"),
  );
  const detail = executable.slice(
    executable.indexOf("create or replace function public.mobile_announcement_detail"),
  );
  assert.match(feed, /coalesce\(v\.all_day, false\) as all_day/);
  assert.match(detail, /coalesce\(a\.all_day, false\)/);
});
