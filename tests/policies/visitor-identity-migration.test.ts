import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const FILE = "supabase/migrations/0053_visitor_identity.sql";
const sql = readFileSync(FILE, "utf8");

/** The migration with `--` comments stripped, for assertions about real SQL. */
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const NEW_TABLES = [
  "visitor_accounts",
  "church_campuses",
  "visitor_church_relationships",
  "visitor_relationship_events",
  "visitor_invitations",
  "visitor_people_claims",
  "visitor_people_links",
  "visitor_people_link_events",
  "visitor_account_requests",
];

test("visitor identity migration sorts after the security baseline", () => {
  const files = readdirSync("supabase/migrations")
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  assert.ok(files.includes("0053_visitor_identity.sql"));
  assert.ok("0053_visitor_identity.sql" > "0050_security_baseline.sql");
  // No duplicate 0053 prefix was introduced.
  assert.equal(files.filter((f) => f.startsWith("0053")).length, 1);
});

for (const table of NEW_TABLES) {
  test(`${table} has RLS enabled and no default browser privileges`, () => {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
      `${table} missing RLS`,
    );
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"),
      `${table} missing revoke`,
    );
  });
}

test("the migration never drops or truncates an existing table", () => {
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+schema\b/i);
});

test("existing People, attendance and staff authorities are left alone", () => {
  // The only permitted alters are the additive ones this migration documents.
  const alters = Array.from(
    sql.matchAll(/alter\s+table\s+public\.([a-z_]+)/gi),
  ).map((m) => m[1].toLowerCase());

  const permitted = new Set([...NEW_TABLES, "churches", "church_service_times"]);
  for (const table of alters) {
    assert.ok(permitted.has(table), `unexpected alter on ${table}`);
  }

  for (const forbidden of ["members", "attendance_records", "attendance_entries", "church_users"]) {
    assert.ok(!alters.includes(forbidden), `must not alter ${forbidden}`);
  }
});

test("churches and service times are only extended, never rewritten", () => {
  const churchAlter = sql.slice(
    sql.indexOf("alter table public.churches"),
    sql.indexOf("do $$"),
  );
  assert.match(churchAlter, /add column if not exists is_discoverable boolean not null default false/i);
  // Off by default: applying this migration must not publish anybody.
  assert.doesNotMatch(churchAlter, /is_discoverable boolean not null default true/i);
  assert.doesNotMatch(sql, /update\s+public\.churches\s+set\s+is_discoverable/i);
  assert.match(sql, /alter table public\.church_service_times\s+add column if not exists campus_id uuid/i);
  // Nullable: existing schedules keep their meaning.
  assert.doesNotMatch(sql, /campus_id uuid not null/i);
});

test("a visitor relationship is unique per account and church", () => {
  const block = sql.slice(
    sql.indexOf("create table if not exists public.visitor_church_relationships"),
    sql.indexOf("create index if not exists visitor_church_relationships_church_state_idx"),
  );
  assert.match(block, /unique \(account_id, church_id\)/);
  assert.match(block, /check \(state in \('following', 'pending', 'joined', 'left', 'blocked'\)\)/);
});

test("People links enforce one live account per person and one person per account", () => {
  assert.match(
    sql,
    /create unique index if not exists visitor_people_links_active_member_idx[\s\S]*?on public\.visitor_people_links \(member_id\)[\s\S]*?where is_active/,
  );
  assert.match(
    sql,
    /create unique index if not exists visitor_people_links_active_account_church_idx[\s\S]*?\(account_id, church_id\)[\s\S]*?where is_active/,
  );
});

test("a self-requested claim can never name a target People record", () => {
  assert.match(
    sql,
    /constraint visitor_people_claims_self_request_has_no_target[\s\S]*?check \(source = 'invitation' or requested_member_id is null\)/,
  );
});

test("only a people_claim invitation may reference a member", () => {
  assert.match(
    sql,
    /constraint visitor_invitations_member_requires_claim_purpose[\s\S]*?check \(member_id is null or purpose = 'people_claim'\)/,
  );
});

test("invitations store a hash and are unreadable by browsers", () => {
  assert.match(sql, /token_hash text not null unique/);
  // No select policy exists for the invitation table at all.
  assert.doesNotMatch(sql, /create policy [a-z_"]*visitor_invitations[a-z_"]*\s+on public\.visitor_invitations/i);
  assert.match(sql, /revoke all on table public\.visitor_invitations from anon, authenticated/);
});

test("invitation consumption is atomic, locked, and refuses a blocked account", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.consume_visitor_invitation"),
    sql.indexOf("revoke all on function\n  public.consume_visitor_invitation"),
  );
  assert.match(fn, /for update/i);
  assert.match(fn, /'wrong_purpose'/);
  assert.match(fn, /'revoked'/);
  assert.match(fn, /'expired'/);
  assert.match(fn, /'exhausted'/);
  assert.match(fn, /'blocked'/);
  assert.match(fn, /used_count = used_count \+ 1/);
});

test("the invitation consumer is service-role only", () => {
  assert.match(
    sql,
    /revoke all on function\s+public\.consume_visitor_invitation\(text, uuid, text, timestamptz\)\s+from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function\s+public\.consume_visitor_invitation\(text, uuid, text, timestamptz\)\s+to service_role/,
  );
});

test("policy helpers are not callable from a browser", () => {
  assert.match(
    sql,
    /revoke execute on function public\.current_visitor_account_id\(\)\s+from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /revoke execute on function public\.is_church_staff\(uuid\)\s+from public, anon, authenticated/,
  );
});

test("every security definer function pins its search path", () => {
  const blocks = sql.split(/create or replace function/i).slice(1);
  for (const block of blocks) {
    if (!/security definer/i.test(block)) continue;
    const name = block.match(/^\s*public\.([a-z_]+)/i)?.[1] ?? "unknown";
    assert.match(block, /set search_path = public/i, `${name} missing search_path`);
  }
});

test("the public projection returns no private or internal church fields", () => {
  const start = sql.indexOf("create or replace function public.discover_churches");
  const end = sql.indexOf("create or replace function public.visitor_claim_status");
  const projection = sql.slice(start, end);

  for (const forbidden of [
    "stripe",
    "access_token",
    "refresh_token",
    "ai_knowledge",
    "onboarding_completed_at",
    "church_users",
    "feature_permissions",
    "office_hours",
  ]) {
    assert.ok(
      !projection.toLowerCase().includes(forbidden),
      `public projection leaks ${forbidden}`,
    );
  }
  // The tenant's internal id is never returned as a public field.
  assert.doesNotMatch(projection, /^\s*c\.id,\s*$/m);
});

test("discovery only ever returns churches that opted in", () => {
  const start = sql.indexOf("create or replace function public.discover_churches");
  const end = sql.indexOf("create or replace function public.visitor_claim_status");
  const projection = sql.slice(start, end);

  // Each of the three public functions filters on is_discoverable.
  const guards = projection.match(/where[\s\S]*?c\.is_discoverable/g) ?? [];
  assert.equal(guards.length, 3, "every public projection must gate on is_discoverable");
});

test("discovery paginates by keyset and caps its own page size", () => {
  assert.match(sql, /\(c\.name, c\.id\) > \(p_cursor_name, p_cursor_id\)/);
  assert.match(sql, /order by c\.name, c\.id/);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 20\), 1\), 50\)/);
  // Keyset only: an OFFSET would skip or repeat rows as churches are listed.
  assert.doesNotMatch(executable, /\boffset\b/i);
});

test("the campus geofence radius is never exposed publicly", () => {
  const start = sql.indexOf("create or replace function public.public_church_campuses");
  const end = sql.indexOf("-- Anonymous discovery is the point");
  const projection = sql.slice(start, end);
  assert.ok(!projection.includes("geofence_radius_m"));
});

test("visitor claim status discloses state but no People identifier", () => {
  const start = sql.indexOf("create or replace function public.visitor_claim_status");
  const end = sql.indexOf("grant execute on function public.visitor_claim_status");
  const fn = sql.slice(start, end);
  assert.ok(!fn.includes("member_id"));
  assert.ok(!fn.includes("resolved_member_id"));
  assert.match(fn, /account_id = public\.current_visitor_account_id\(\)/);
});

test("campus coordinates, radius and primary flag are constrained by the database", () => {
  assert.match(sql, /latitude numeric\(9, 6\) check \(latitude between -90 and 90\)/);
  assert.match(sql, /longitude numeric\(9, 6\) check \(longitude between -180 and 180\)/);
  assert.match(sql, /check \(\(latitude is null\) = \(longitude is null\)\)/);
  assert.match(sql, /geofence_radius_m integer not null default 150\s+check \(geofence_radius_m between 25 and 2000\)/);
  assert.match(
    sql,
    /create unique index if not exists church_campuses_one_primary_idx[\s\S]*?on public\.church_campuses \(church_id\)[\s\S]*?where is_primary/,
  );
});

test("campus timezone is validated against real zones at write time", () => {
  assert.match(sql, /select 1 from pg_timezone_names where name = new\.timezone/);
  assert.match(sql, /create trigger church_campuses_validate_timezone/);
});

test("one open export or deletion request per account", () => {
  assert.match(
    sql,
    /create unique index if not exists visitor_account_requests_one_open_idx[\s\S]*?\(account_id, kind\)[\s\S]*?where status in \('pending', 'processing'\)/,
  );
  assert.match(sql, /unique \(account_id, kind, idempotency_key\)/);
});

test("a visitor account is one-to-one with a credential", () => {
  assert.match(sql, /user_id uuid not null unique references auth\.users \(id\) on delete cascade/);
});

test("relationship and claim tables have no browser write policy", () => {
  for (const table of [
    "visitor_church_relationships",
    "visitor_people_claims",
    "visitor_people_links",
    "visitor_relationship_events",
    "visitor_people_link_events",
    "visitor_account_requests",
  ]) {
    const policies = sql.match(
      new RegExp(`create policy[^;]*on public\\.${table}[^;]*;`, "gi"),
    ) ?? [];
    for (const policy of policies) {
      assert.match(policy, /for select/i, `${table} has a non-select policy`);
    }
  }
});
