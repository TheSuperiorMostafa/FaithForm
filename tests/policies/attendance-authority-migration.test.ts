import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const FILE = "supabase/migrations/0055_attendance_authority.sql";
const sql = readFileSync(FILE, "utf8");
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const NEW_TABLES = [
  "attendance_policies",
  "service_occurrences",
  "attendance_attempts",
  "attendance_facts",
  "attendance_corrections",
  "attendance_legacy_map",
  "attendance_qr_redemptions",
  "attendance_kiosk_credentials",
];

test("the migration sorts after every prior Faithful migration", () => {
  const files = readdirSync("supabase/migrations")
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  assert.ok(files.includes("0055_attendance_authority.sql"));
  assert.ok("0055_attendance_authority.sql" > "0054_faithful_publication_and_push.sql");
  assert.equal(files.filter((f) => f.startsWith("0055")).length, 1);
});

for (const table of NEW_TABLES) {
  test(`${table} has RLS and no default browser privileges`, () => {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
  });
}

// ---------------------------------------------------------------------------
// The core invariant
// ---------------------------------------------------------------------------

test("the database enforces one counted fact per occurrence and member", () => {
  assert.match(
    sql,
    /create unique index if not exists attendance_facts_unique_idx\s+on public\.attendance_facts \(service_occurrence_id, member_id\)/,
  );
});

test("the uniqueness is NOT partial, so a reversal cannot be followed by a second insert", () => {
  const index = sql.slice(
    sql.indexOf("create unique index if not exists attendance_facts_unique_idx"),
    sql.indexOf("-- Reports count active facts"),
  );
  // A `where status = 'active'` here would let a reversed row be re-inserted
  // alongside, silently double-counting on restore.
  assert.ok(!index.includes("where"), "the counted-fact index must not be partial");
});

test("a fact is reversed, never deleted", () => {
  assert.match(sql, /status text not null default 'active'\s+check \(status in \('active', 'reversed'\)\)/);
  assert.doesNotMatch(executable, /delete from public\.attendance_facts/i);
});

// ---------------------------------------------------------------------------
// The transactional command
// ---------------------------------------------------------------------------

test("exactly one function may create a counted fact", () => {
  const inserts = executable.match(/insert into public\.attendance_facts/gi) ?? [];
  assert.equal(inserts.length, 1, "only record_attendance may insert a counted fact");

  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  assert.ok(command.includes("insert into public.attendance_facts"));
});

test("concurrency is handled by the unique index, not a read-then-write check", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  assert.match(command, /on conflict \(service_occurrence_id, member_id\) do nothing/);
  // The loser of the race reads the winner's row rather than failing.
  assert.match(command, /if new_fact_id is not null then/);
  assert.match(command, /'already_counted'/);
});

test("the command resolves tenancy itself and never trusts a caller", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  // The church comes from the occurrence.
  assert.match(command, /from public\.service_occurrences\s+where id = p_occurrence_id/);
  // And the member must belong to it.
  assert.match(command, /member_church is null or member_church <> occ\.church_id/);
  assert.match(command, /'member_not_in_church'/);
  // There is no p_church_id parameter at all.
  assert.ok(!/p_church_id/.test(command), "the command must not accept a church id");
});

test("idempotency is checked before validation, so a retry is not re-judged", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  const idempotencyAt = command.indexOf("from public.attendance_attempts");
  const windowAt = command.indexOf("checkin_opens_at_utc");
  assert.ok(
    idempotencyAt > 0 && idempotencyAt < windowAt,
    "a retried attempt must return its earlier result, not be re-judged against a closed window",
  );
});

test("an attempt is appended whatever the verdict", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  const insertAt = command.indexOf("insert into public.attendance_attempts");
  const rejectReturn = command.indexOf("if attempt_status <> 'counted' then");
  assert.ok(
    insertAt > 0 && insertAt < rejectReturn,
    "a rejected attempt must still be recorded — it is what someone will ask about",
  );
});

test("every attempt outcome the command can produce is enumerated", () => {
  for (const reason of [
    "occurrence_cancelled",
    "source_disabled",
    "too_early",
    "too_late",
    "no_people_link",
    "member_not_in_church",
    "insufficient_accuracy",
    "outside_region",
    "awaiting_dwell",
  ]) {
    assert.ok(sql.includes(`'${reason}'`), `missing outcome ${reason}`);
  }
});

test("the source must be enabled in the occurrence's own snapshot", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  // Judged against the snapshot, not the live policy — so a policy edited after
  // a service cannot retroactively change how its attempts were judged.
  assert.match(command, /occ\.policy_snapshot -> 'sources' ->> p_source/);
});

test("a previously reversed fact is not silently revived by a new attempt", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  assert.match(command, /when existing_fact\.status = 'reversed' then 'reversed'/);
});

test("the command and corrections are service-role only", () => {
  for (const fn of ["record_attendance", "correct_attendance", "generate_service_occurrences"]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)[\\s\\S]{0,80}from public, anon, authenticated`),
      `${fn} is not revoked`,
    );
  }
});

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

test("occurrence identity is the schedule plus the resolved start, not church and date", () => {
  assert.match(
    sql,
    /create unique index if not exists service_occurrences_schedule_idx\s+on public\.service_occurrences \(service_time_id, starts_at_utc\)/,
  );
  // Two services on one Sunday are two rows; a fall-back DST day with two
  // 01:30 locals resolves to two different instants.
  assert.ok(!/unique.*\(church_id, local_service_date\)/i.test(sql));
});

test("a manual occurrence has its own identity", () => {
  assert.match(sql, /create unique index if not exists service_occurrences_manual_idx/);
  assert.match(sql, /where service_time_id is null/);
});

test("an occurrence snapshots schedule, campus, timezone, windows and policy", () => {
  const table = sql.slice(
    sql.indexOf("create table if not exists public.service_occurrences"),
    sql.indexOf("create unique index if not exists service_occurrences_schedule_idx"),
  );
  for (const column of [
    "timezone",
    "starts_at_utc",
    "checkin_opens_at_utc",
    "checkin_closes_at_utc",
    "policy_version",
    "policy_snapshot",
    "campus_latitude",
    "geofence_radius_m",
  ]) {
    assert.ok(table.includes(column), `occurrence must snapshot ${column}`);
  }
});

test("DST is resolved by Postgres, not by offset arithmetic", () => {
  const generator = sql.slice(
    sql.indexOf("create or replace function public.generate_service_occurrences"),
    sql.indexOf("revoke all on function public.generate_service_occurrences"),
  );
  // `AT TIME ZONE` knows about transitions; an interval calculation does not.
  assert.match(generator, /local_start at time zone zone/);
  assert.ok(!/interval '\d+ hours'/.test(generator), "must not hard-code an offset");
});

test("generation is idempotent and bounded", () => {
  const generator = sql.slice(
    sql.indexOf("create or replace function public.generate_service_occurrences"),
    sql.indexOf("revoke all on function public.generate_service_occurrences"),
  );
  assert.match(generator, /do nothing/);
  assert.match(generator, /if p_to_date - p_from_date > 400 then/);
});

test("a cancelled occurrence refuses new attendance", () => {
  const command = sql.slice(
    sql.indexOf("create or replace function public.record_attendance"),
    sql.indexOf("revoke all on function public.record_attendance"),
  );
  assert.match(command, /if occ\.status = 'cancelled' then[\s\S]{0,120}'occurrence_cancelled'/);
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test("automatic attendance is off until explicitly enabled", () => {
  assert.match(sql, /geofence_enabled boolean not null default false/);
  assert.match(sql, /qr_enabled boolean not null default false/);
  assert.match(sql, /kiosk_enabled boolean not null default false/);
  // Manual stays on: it is what the dashboard already does.
  assert.match(sql, /manual_enabled boolean not null default true/);
});

test("contradictory policies are rejected by the database", () => {
  assert.match(sql, /constraint attendance_policies_window_sane/);
  assert.match(sql, /constraint attendance_policies_confirmation_sane/);
  assert.match(sql, /constraint attendance_policies_one_scope/);
});

test("policy bounds are enforced, not merely suggested", () => {
  assert.match(sql, /max_location_accuracy_m integer not null default 100\s+check \(max_location_accuracy_m between 10 and 500\)/);
  assert.match(sql, /min_dwell_seconds integer not null default 120\s+check \(min_dwell_seconds between 0 and 3600\)/);
  assert.match(sql, /evidence_retention_days integer not null default 14\s+check \(evidence_retention_days between 1 and 90\)/);
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test("an attempt stores coarse bands, not coordinates", () => {
  const table = sql.slice(
    sql.indexOf("create table if not exists public.attendance_attempts"),
    sql.indexOf("create unique index if not exists attendance_attempts_idempotency_idx"),
  );
  assert.match(table, /distance_band text/);
  assert.match(table, /accuracy_band text/);
  // No latitude or longitude column exists on an attempt at all.
  assert.ok(!/\blatitude\b/.test(table), "attempts must not carry a latitude column");
  assert.ok(!/\blongitude\b/.test(table), "attempts must not carry a longitude column");
});

test("precise evidence expires and is purgeable", () => {
  assert.match(sql, /precise_evidence jsonb/);
  assert.match(sql, /evidence_expires_at timestamptz/);
  assert.match(sql, /create index if not exists attendance_attempts_evidence_purge_idx/);
});

test("a counted fact carries no location at all", () => {
  const table = sql.slice(
    sql.indexOf("create table if not exists public.attendance_facts"),
    sql.indexOf("-- THE INVARIANT"),
  );
  for (const forbidden of ["latitude", "longitude", "accuracy", "evidence", "distance"]) {
    assert.ok(!table.includes(forbidden), `a counted fact must not carry ${forbidden}`);
  }
});

test("a person's own attendance is visible to them and to church staff, nobody else", () => {
  const policy = sql.slice(
    sql.indexOf("create policy attendance_facts_select"),
    sql.indexOf("create policy attendance_corrections_select"),
  );
  assert.match(policy, /public\.is_church_staff\(church_id\)/);
  assert.match(policy, /from public\.visitor_people_links l/);
  assert.match(policy, /l\.is_active/);
  assert.match(policy, /l\.account_id = public\.current_visitor_account_id\(\)/);
});

test("kiosk credentials store only a hash and have no browser policy", () => {
  assert.match(sql, /credential_hash text not null unique/);
  assert.doesNotMatch(sql, /create policy[^;]*on public\.attendance_kiosk_credentials/i);
});

test("a replayed QR code collides", () => {
  assert.match(
    sql,
    /create unique index if not exists attendance_qr_redemptions_nonce_idx\s+on public\.attendance_qr_redemptions \(service_occurrence_id, nonce\)/,
  );
});

// ---------------------------------------------------------------------------
// Legacy
// ---------------------------------------------------------------------------

test("the legacy tables are not altered, dropped, or written by this migration", () => {
  const alters = Array.from(executable.matchAll(/alter\s+table\s+public\.([a-z_]+)/gi)).map((m) =>
    m[1].toLowerCase(),
  );
  for (const legacy of ["attendance_records", "attendance_entries", "attendance", "members"]) {
    assert.ok(!alters.includes(legacy), `must not alter ${legacy}`);
  }
  assert.doesNotMatch(executable, /\bdrop\s+table\b/i);
  assert.doesNotMatch(executable, /\btruncate\b/i);
});

test("the unused aggregate attendance table is not adopted", () => {
  // It is referenced nowhere in the new authority.
  assert.ok(!/from public\.attendance\b/.test(executable));
  assert.ok(!/insert into public\.attendance\b/.test(executable));
});

test("legacy mapping records ambiguity rather than resolving it", () => {
  assert.match(
    sql,
    /resolution text not null\s+check \(resolution in \('mapped', 'ambiguous', 'orphaned', 'skipped_absent', 'duplicate'\)\)/,
  );
  assert.match(sql, /create unique index if not exists attendance_legacy_map_entry_idx/);
});

// ---------------------------------------------------------------------------
// Corrections and reporting
// ---------------------------------------------------------------------------

test("corrections are append-only and carry both states", () => {
  const table = sql.slice(
    sql.indexOf("create table if not exists public.attendance_corrections"),
    sql.indexOf("create index if not exists attendance_corrections_occurrence_idx"),
  );
  assert.match(table, /previous_status text/);
  assert.match(table, /new_status text/);
  assert.match(table, /actor_user_id uuid/);
  assert.doesNotMatch(executable, /update public\.attendance_corrections/i);
  assert.doesNotMatch(executable, /delete from public\.attendance_corrections/i);
});

test("a correction requires the exact church and locks the row", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.correct_attendance"),
    sql.indexOf("revoke all on function public.correct_attendance"),
  );
  assert.match(fn, /where id = p_fact_id and church_id = p_church_id/);
  assert.match(fn, /for update/);
  // Re-applying the same correction is a no-op, not a second audit row.
  assert.match(fn, /if fact\.status = target_status then/);
});

test("reporting aggregates in SQL", () => {
  const report = sql.slice(
    sql.indexOf("create or replace function public.attendance_report"),
    sql.indexOf("revoke all on function public.attendance_report"),
  );
  assert.match(report, /count\(\*\) filter \(where af\.status = 'active'\)/);
  assert.match(report, /jsonb_object_agg/);
  // Bounded by a date range rather than scanning everything.
  assert.match(report, /o\.starts_at_utc >= p_from/);
});

test("every security definer function pins its search path", () => {
  for (const block of sql.split(/create or replace function/i).slice(1)) {
    if (!/security definer/i.test(block)) continue;
    const name = block.match(/^\s*public\.([a-z_]+)/i)?.[1] ?? "unknown";
    assert.match(block, /set search_path = public/i, `${name} missing search_path`);
  }
});

test("indexes correspond to the exact filters and orders the code uses", () => {
  // Roster and reporting.
  assert.match(sql, /attendance_facts_occurrence_active_idx[\s\S]{0,120}where status = 'active'/);
  // Person history.
  assert.match(sql, /attendance_facts_member_history_idx[\s\S]{0,120}\(member_id, counted_at desc\)/);
  // "Which occurrence is open right now".
  assert.match(sql, /service_occurrences_open_window_idx[\s\S]{0,200}where status in \('scheduled', 'active'\)/);
  // Idempotency lookup.
  assert.match(sql, /attendance_attempts_idempotency_idx[\s\S]{0,120}\(service_occurrence_id, source, idempotency_key\)/);
});
