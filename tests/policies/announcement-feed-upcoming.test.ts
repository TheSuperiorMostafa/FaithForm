import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * 0076 replaces the announcement feed's time rules.
 *
 * 0054 hid every announcement whose *event* had not started yet, so the app's
 * home feed only ever showed events in progress. These pin the corrected rules
 * as text; the behaviour itself was exercised against a local Supabase stack
 * (upcoming shown soonest first, ended and future-published hidden, cursor
 * pages through pinned and unpinned rows).
 */
const FILE = "supabase/migrations/0076_announcement_feed_upcoming_events.sql";
const sql = readFileSync(FILE, "utf8");
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const feed = executable.slice(
  executable.indexOf("create or replace function public.mobile_announcement_feed"),
  executable.indexOf("create or replace function public.mobile_announcement_detail"),
);
const detail = executable.slice(
  executable.indexOf("create or replace function public.mobile_announcement_detail"),
);

test("0076 has a unique prefix", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.startsWith("0076"));
  assert.deepEqual(files, ["0076_announcement_feed_upcoming_events.sql"]);
});

for (const [name, body] of [["feed", feed], ["detail", detail]] as const) {
  test(`${name}: an upcoming event is not hidden until it starts`, () => {
    assert.doesNotMatch(body, /coalesce\(\w\.start_at, \w\.event_date\) <= p_now/);
  });

  test(`${name}: publication, withdrawal and targeting still gate every row`, () => {
    assert.match(body, /status = 'published'/);
    assert.match(body, /is_ready/);
    assert.match(body, /mobile_unpublished_at is null/);
    assert.match(body, /mobile_visibility <> 'none'/);
    assert.match(body, /coalesce\(\w\.mobile_published_at, \w\.published_at, p_now\) <= p_now/);
    assert.match(body, /'followers'[\s\S]{0,80}p_relationship_state in \('following', 'joined'\)/);
    assert.match(body, /'members'[\s\S]{0,80}p_relationship_state = 'joined'/);
  });

  test(`${name}: an event drops out once it is over, even without an end time`, () => {
    assert.match(body, /coalesce\(\s*\w\.end_at,/);
    assert.match(body, /interval '2 days' else interval '1 day'/);
    assert.match(body, /\) > p_now/);
  });

  test(`${name}: callable by the service role only`, () => {
    assert.match(sql, new RegExp(`revoke all on function\\s+public\\.mobile_announcement_${name}\\([^)]*\\)\\s+from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function\\s+public\\.mobile_announcement_${name}\\([^)]*\\)\\s+to service_role`));
  });
}

test("feed: pinned first, then soonest, and the cursor follows that order", () => {
  assert.match(feed, /order by\s+v\.effective_pinned desc,\s+v\.effective_start asc,\s+v\.id asc/);
  assert.match(feed, /\(v\.effective_start, v\.id\) > \(p_cursor_start, p_cursor_id\)/);
  assert.match(feed, /coalesce\(p_cursor_pinned, false\) and not v\.effective_pinned/);
});

test("feed: no dashboard or provider field is projected", () => {
  for (const forbidden of [
    "facebook_post_id",
    "google_event_id",
    "gmail_draft_id",
    "last_publish_error",
    "published_by",
    "facebook_caption",
    "social_graphic_path",
  ]) {
    const select = feed.slice(feed.indexOf("select\n    v.id"), feed.indexOf("from visible v"));
    assert.ok(!select.includes(forbidden), `feed must not project ${forbidden}`);
  }
});
