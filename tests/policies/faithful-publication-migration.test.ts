import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const FILE = "supabase/migrations/0054_faithful_publication_and_push.sql";
const sql = readFileSync(FILE, "utf8");
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const NEW_TABLES = [
  "visitor_device_installations",
  "visitor_notification_preferences",
  "notification_outbox",
  "notification_delivery_attempts",
];

test("the migration sorts after 0050 and 0053, with no duplicate prefix", () => {
  const files = readdirSync("supabase/migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assert.ok(files.includes("0054_faithful_publication_and_push.sql"));
  assert.ok("0054_faithful_publication_and_push.sql" > "0053_visitor_identity.sql");
  assert.equal(files.filter((f) => f.startsWith("0054")).length, 1);
});

for (const table of NEW_TABLES) {
  test(`${table} has RLS and no default browser privileges`, () => {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
  });
}

test("applying the migration publishes nothing to the app", () => {
  // Default 'none' is what makes this safe on a live database.
  assert.match(sql, /add column if not exists mobile_visibility text not null default 'none'/);
  assert.doesNotMatch(executable, /update\s+public\.announcements\s+set[^;]*mobile_visibility\s*=\s*'(public|followers|members)'/i);
});

test("no existing People, attendance, or staff authority is altered", () => {
  const alters = Array.from(executable.matchAll(/alter\s+table\s+public\.([a-z_]+)/gi)).map((m) =>
    m[1].toLowerCase(),
  );
  const permitted = new Set([...NEW_TABLES, "announcements"]);
  for (const table of alters) assert.ok(permitted.has(table), `unexpected alter on ${table}`);
  for (const forbidden of ["members", "attendance_records", "church_users", "visitor_accounts"]) {
    assert.ok(!alters.includes(forbidden), `must not alter ${forbidden}`);
  }
});

test("the feed excludes draft, scheduled, expired, unpublished and untargeted rows", () => {
  const feed = sql.slice(
    sql.indexOf("create or replace function public.mobile_announcement_feed"),
    sql.indexOf("-- One announcement, re-authorized on read"),
  );
  assert.match(feed, /a\.status = 'published'/);
  assert.match(feed, /and a\.is_ready/);
  assert.match(feed, /a\.mobile_unpublished_at is null/);
  assert.match(feed, /a\.mobile_visibility <> 'none'/);
  // Scheduled-but-not-live.
  assert.match(feed, /coalesce\(a\.start_at, a\.event_date\) <= p_now/);
  // Expired.
  assert.match(feed, /a\.end_at is null or a\.end_at > p_now/);
});

test("targeting maps exactly to the relationship model, with no second membership", () => {
  const feed = sql.slice(
    sql.indexOf("create or replace function public.mobile_announcement_feed"),
    sql.indexOf("-- One announcement, re-authorized on read"),
  );
  assert.match(feed, /a\.mobile_visibility = 'public'/);
  assert.match(feed, /'followers'[\s\S]{0,80}p_relationship_state in \('following', 'joined'\)/);
  assert.match(feed, /'members'[\s\S]{0,80}p_relationship_state = 'joined'/);
});

test("the feed and detail projections expose no dashboard or provider field", () => {
  const projections = sql.slice(
    sql.indexOf("create or replace function public.mobile_announcement_feed"),
    sql.indexOf("-- DEVICE INSTALLATIONS"),
  );
  for (const forbidden of [
    "facebook_post_id",
    "google_event_id",
    "gmail_draft_id",
    "last_publish_error",
    "created_by",
    "published_by",
    "facebook_caption",
    "social_graphic_path",
  ]) {
    assert.ok(!projections.includes(forbidden), `projection leaks ${forbidden}`);
  }
});

test("feed pagination is keyset, bounded, and never offset", () => {
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)/);
  assert.doesNotMatch(executable, /\boffset\b/i);
  assert.match(sql, /order by[\s\S]{0,200}a\.id desc/);
});

test("nearby search is bounded by an indexed box before any distance maths", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.discover_churches_nearby"),
    sql.indexOf("grant execute on function\n  public.discover_churches_nearby"),
  );
  // The bounding box is what keeps this off a full-table distance scan.
  assert.match(fn, /cc\.latitude between p_latitude - box\.lat_delta and p_latitude \+ box\.lat_delta/);
  assert.match(fn, /cc\.longitude between p_longitude - box\.lon_delta and p_longitude \+ box\.lon_delta/);
  // Radius and limit are clamped server-side.
  assert.match(fn, /least\(greatest\(coalesce\(p_radius_km, 40\), 1\), 200\)/);
  // Only discoverable churches.
  assert.match(fn, /c\.is_discoverable/);
  // A near-polar query cannot produce an unbounded box.
  assert.match(fn, /greatest\(cos\(radians\(p_latitude\)\), 0\.01\)/);
  assert.match(sql, /create index if not exists church_campuses_geo_idx/);
});

test("worker claim is atomic, leased, and skips locked rows", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.claim_notification_jobs"),
    sql.indexOf("create or replace function public.complete_notification_job"),
  );
  assert.match(fn, /for update skip locked/);
  assert.match(fn, /lease_expires_at = p_now \+ make_interval/);
  assert.match(fn, /attempts = o\.attempts \+ 1/);
  assert.match(fn, /o\.attempts < o\.max_attempts/);
});

test("only the lease holder may complete a job, and backoff is capped", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.complete_notification_job"));
  assert.match(fn, /and o\.lease_token = p_lease_token/);
  assert.match(fn, /least\(greatest\(p_backoff_seconds, 10\) \* power\(2, o\.attempts - 1\), 3600\)/);
  assert.match(fn, /when o\.attempts >= o\.max_attempts then 'failed'/);
});

test("a logical notification cannot be duplicated", () => {
  assert.match(sql, /dedupe_key text not null unique/);
  assert.match(sql, /collapse_key text not null/);
  // And one attempt row per installation per attempt.
  assert.match(sql, /unique \(outbox_id, installation_id, attempt_number\)/);
});

test("installations are service-role only and unique per install", () => {
  assert.match(sql, /unique \(install_id, environment\)/);
  // No policy of any kind for browsers on the token-bearing table.
  assert.doesNotMatch(sql, /create policy[^;]*on public\.visitor_device_installations/i);
  assert.match(sql, /revoke all on table public\.visitor_device_installations from anon, authenticated/);
});

test("worker functions are service-role only", () => {
  for (const fn of ["claim_notification_jobs", "complete_notification_job"]) {
    assert.match(sql, new RegExp(`revoke all on function\\s+public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function\\s+public\\.${fn}\\([^)]*\\) to service_role`));
  }
});

test("mobile feed functions are not callable from a browser", () => {
  for (const fn of ["mobile_announcement_feed", "mobile_announcement_detail"]) {
    assert.match(sql, new RegExp(`revoke all on function\\s+public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`));
  }
});

test("every security definer function pins its search path", () => {
  for (const block of sql.split(/create or replace function/i).slice(1)) {
    if (!/security definer/i.test(block)) continue;
    const name = block.match(/^\s*public\.([a-z_]+)/i)?.[1] ?? "unknown";
    assert.match(block, /set search_path = public/i, `${name} missing search_path`);
  }
});

test("publication version only moves for fields a device renders", () => {
  const trigger = sql.slice(
    sql.indexOf("create or replace function public.bump_announcement_publication_version"),
    sql.indexOf("drop trigger if exists announcements_bump_publication_version"),
  );
  for (const rendered of ["title", "body", "start_at", "mobile_visibility", "is_pinned", "poster_alt_text"]) {
    assert.ok(trigger.includes(rendered), `version must react to ${rendered}`);
  }
  // Provider bookkeeping must not invalidate every cached feed.
  for (const invisible of ["facebook_post_id", "gmail_draft_id", "last_publish_error"]) {
    assert.ok(!trigger.includes(invisible), `version must not react to ${invisible}`);
  }
});
