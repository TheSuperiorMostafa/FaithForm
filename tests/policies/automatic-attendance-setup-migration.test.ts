import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Migration 0074 by inspection. Its behaviour is executed against Postgres in
 * `tests/database/automatic-attendance-setup.test.ts`; what is pinned here is
 * the shape that must not drift: who may call what, what the refresh is allowed
 * to touch, and what consent withdrawal is never allowed to touch.
 */

const FILE = "supabase/migrations/0074_automatic_attendance_setup.sql";
const sql = readFileSync(FILE, "utf8");
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of one function, from its `create` to the next `$$;`. */
function functionBody(name: string): string {
  const start = executable.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is not defined`);
  const end = executable.indexOf("$$;", start);
  return executable.slice(start, end);
}

const FUNCTIONS = [
  ["attendance_effective_campus", "uuid, uuid"],
  ["attendance_policy_for", "uuid, uuid, uuid"],
  ["attendance_policy_snapshot", "public.attendance_policies"],
  ["generate_service_occurrences", "uuid, date, date, timestamptz"],
  ["create_manual_occurrence", "\\s*uuid, uuid, text, date, time, integer, text, integer, integer, uuid\\s*"],
  ["refresh_upcoming_service_occurrences", "uuid, timestamptz"],
  ["purge_expired_attendance_detections", "timestamptz, integer"],
  ["withdraw_automatic_attendance_evidence", "uuid, timestamptz"],
] as const;

test("the migration has its own number and sorts after 0073", () => {
  const files = readdirSync("supabase/migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name));
  assert.equal(files.filter((file) => file.startsWith("0074")).length, 1);
  assert.ok("0074_automatic_attendance_setup.sql" > "0073_account_deletion_record.sql");
});

for (const [name, signature] of FUNCTIONS) {
  test(`${name} is service-role only, with a pinned search path`, () => {
    const body = functionBody(name);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = public/);
    assert.match(
      executable,
      new RegExp(`revoke all on function public\\.${name}\\(${signature}\\)\\s+from public, anon, authenticated;`),
    );
    assert.match(
      executable,
      new RegExp(`grant execute on function public\\.${name}\\(${signature}\\)\\s+to service_role;`),
    );
  });
}

test("the setup audit table is server-only", () => {
  assert.match(executable, /alter table public\.attendance_setup_events enable row level security/);
  assert.match(
    executable,
    /revoke all on table public\.attendance_setup_events from public, anon, authenticated/,
  );
  // No policy: nothing a browser holds can read who changed a church's setup.
  assert.doesNotMatch(executable, /create policy[^;]*attendance_setup_events/);
});

test("the check-in radius is bounded to 50 to 500 metres, clamping first", () => {
  assert.match(
    executable,
    /set geofence_radius_m = least\(500, greatest\(50, geofence_radius_m\)\)/,
  );
  assert.match(executable, /check \(geofence_radius_m between 50 and 500\)/);
  const clamp = executable.indexOf("least(500, greatest(50");
  const constraint = executable.indexOf("between 50 and 500");
  assert.ok(clamp < constraint, "existing rows are clamped before the constraint is added");
});

test("refresh only touches services whose check-in has not opened", () => {
  const body = functionBody("refresh_upcoming_service_occurrences");
  assert.match(body, /o\.status = 'scheduled'/);
  assert.match(body, /o\.checkin_opens_at_utc > p_now/);
  // Only the rows selected above are updated or retired.
  for (const write of body.match(/(update|delete from) public\.service_occurrences[\s\S]*?where[^;]*;/g) ?? []) {
    assert.match(write, /occ\.id/, `a write escapes the not-yet-open set: ${write.slice(0, 80)}`);
  }
});

test("refresh never deletes a service anything points at", () => {
  const body = functionBody("refresh_upcoming_service_occurrences");
  for (const table of [
    "attendance_attempts",
    "attendance_facts",
    "attendance_corrections",
    "attendance_detections",
    "attendance_checkin_sessions",
    "attendance_kiosk_sessions",
  ]) {
    assert.match(body, new RegExp(`from public\\.${table} \\w+ where \\w+\\.service_occurrence_id = occ\\.id`), table);
  }
  const branch = body.slice(body.indexOf("if referenced then"), body.indexOf("retired_count := retired_count + 1"));
  assert.match(branch, /status = 'cancelled'[\s\S]*cancellation_reason = 'schedule_changed'[\s\S]*else\s+delete/);
});

test("nothing in the migration rewrites attendance history", () => {
  for (const table of ["attendance_facts", "attendance_corrections"]) {
    assert.doesNotMatch(
      executable,
      new RegExp(`(update|delete from|insert into) public\\.${table}\\b`),
      `0074 writes ${table}`,
    );
  }
  assert.doesNotMatch(executable, /delete from public\.attendance_attempts/);
  assert.doesNotMatch(executable, /drop table/);
});

test("withdrawing consent removes pending evidence and never a counted check-in", () => {
  const body = functionBody("withdraw_automatic_attendance_evidence");
  assert.match(body, /delete from public\.attendance_detections\s+where account_id = p_account_id/);
  assert.match(
    body,
    /set status = 'expired',\s+result_reason = 'consent_revoked'[\s\S]*?and source = 'geofence'\s+and status = 'pending_confirmation'/,
  );
  assert.doesNotMatch(body, /status = 'counted'/);
});

test("the detection purge removes expired rows only, in bounded batches", () => {
  const body = functionBody("purge_expired_attendance_detections");
  assert.match(body, /where x\.expires_at <= p_now/);
  assert.match(body, /limit greatest\(1, least\(coalesce\(p_limit, 5000\), 50000\)\)/);
});

test("the generator still resolves instants with AT TIME ZONE and no fixed offset", () => {
  const body = functionBody("generate_service_occurrences");
  assert.match(body, /resolved_start := local_start at time zone zone/);
  assert.doesNotMatch(body, /interval '-?\d+ hours?'/);
  assert.match(body, /on conflict \(service_time_id, starts_at_utc\)/);
  assert.match(body, /public\.attendance_effective_campus\(p_church_id, st\.campus_id\)/);
});

test("a schedule's orphans are outside the manual-occurrence identity", () => {
  assert.match(
    executable,
    /where service_time_id is null and generation_source <> 'schedule';/,
  );
});
