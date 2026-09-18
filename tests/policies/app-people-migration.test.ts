import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Migration 0083 by inspection: who may call what, and what each function may
 * touch. The behaviour itself is exercised against Postgres in
 * tests/database/app-people-and-attendance.test.ts.
 */

const FILE = "supabase/migrations/0083_app_members_in_people_and_one_attendance.sql";
const sql = readFileSync(FILE, "utf8");

const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function body(name: string): string {
  const start = executable.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is not defined`);
  const end = executable.indexOf("$$;", executable.indexOf("$$", start) + 2);
  return executable.slice(start, end + 3);
}

/** Server-only commands: they write People, links and claims. */
const PRIVILEGED: Record<string, string> = {
  app_account_name: "uuid",
  connect_app_member: "uuid, uuid, uuid",
  add_people_claim_as_new_person: "uuid, uuid, uuid, text, text",
  move_people_link: "uuid, uuid, uuid, uuid",
};

/** Reads for the dashboard, under the caller's own row security. */
const READS: Record<string, string> = {
  attendance_presence: "uuid, date, date",
  attendance_presence_by_date: "uuid, date, date",
  attendance_presence_by_member: "uuid",
};

test("0083 is one file", () => {
  const files = readdirSync("supabase/migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name));
  assert.equal(files.filter((file) => file.startsWith("0083")).length, 1);
});

for (const [name, signature] of Object.entries(PRIVILEGED)) {
  test(`${name} runs as the owner, with a fixed search path, for the server only`, () => {
    const fn = body(name);
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = public/);
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.match(
      executable,
      new RegExp(`revoke all on function public\\.${name}\\(${escaped}\\)\\s+from public, anon, authenticated;`),
    );
    assert.match(
      executable,
      new RegExp(`grant execute on function public\\.${name}\\(${escaped}\\)\\s+to service_role;`),
    );
    assert.doesNotMatch(
      executable,
      new RegExp(`grant [^;]*on function public\\.${name}\\([^)]*\\)[^;]*\\b(anon|authenticated)\\b`),
    );
  });
}

for (const [name, signature] of Object.entries(READS)) {
  test(`${name} reads as the caller, so row security decides what it sees`, () => {
    const fn = body(name);
    assert.doesNotMatch(fn, /security definer/);
    assert.match(fn, /language sql\s+stable/);
    const escaped = signature.replace(/[()]/g, "\\$&");
    assert.match(executable, new RegExp(`revoke all on function public\\.${name}\\(${escaped}\\) from public, anon;`));
    assert.match(
      executable,
      new RegExp(`grant execute on function public\\.${name}\\(${escaped}\\)\\s+to authenticated, service_role;`),
    );
    // A read never writes.
    assert.doesNotMatch(fn, /\b(insert into|update public|delete from)\b/);
  });
}

test("every way into joined connects the person, and never blocks the join", () => {
  assert.match(
    executable,
    /create trigger visitor_church_relationships_connect_people\s+after insert or update of state on public\.visitor_church_relationships\s+for each row execute function public\.connect_app_member_on_join\(\);/,
  );
  const trigger = body("connect_app_member_on_join");
  assert.match(trigger, /new\.state = 'joined'/);
  assert.match(trigger, /old\.state is distinct from 'joined'/);
  // A failure to connect is a warning, not a failed join.
  assert.match(trigger, /exception when others then\s+raise warning/);
});

test("people who joined before this migration get the same decision", () => {
  assert.match(
    executable,
    /for v_row in\s+select r\.account_id, r\.church_id\s+from public\.visitor_church_relationships r\s+where r\.state = 'joined'/,
  );
  assert.match(executable, /perform public\.connect_app_member\(v_row\.account_id, v_row\.church_id, null\);/);
});

test("two devices joining at once make one person", () => {
  for (const name of ["connect_app_member", "add_people_claim_as_new_person"]) {
    assert.match(
      body(name),
      /pg_advisory_xact_lock\(\s*hashtextextended\('connect_app_member:' \|\|/,
      `${name} must take the per-account, per-church lock`,
    );
  }
});

test("a claim may now come from joining, and still never names a target", () => {
  assert.match(executable, /check \(source in \('self_request', 'invitation', 'join'\)\)/);
  // The rule that a self-made claim names nobody is left in place.
  assert.match(executable, /!~ 'requested_member_id'/);
  assert.doesNotMatch(body("connect_app_member"), /requested_member_id/);
});

test("only a record FaithForm created on joining is ever retired, and none is deleted", () => {
  const move = body("move_people_link");
  assert.match(move, /if v_from\.source = 'app' then/);
  const retire = move.slice(move.indexOf("if v_from.source = 'app' then"));
  assert.match(retire, /update public\.members\s+set is_active = false\s+where id = p_from_member_id;/);
  assert.doesNotMatch(executable, /delete from public\.members/);
  // Before the source check, only links and their audit trail change.
  const before = move.slice(0, move.indexOf("if v_from.source = 'app' then"));
  assert.doesNotMatch(before, /attendance_|checkin_sessions|update public\.members/);
});

test("merging never counts one person twice, and says so when it reverses a count", () => {
  const move = body("move_people_link");
  assert.match(move, /insert into public\.attendance_corrections[\s\S]*?'reverse'/);
  assert.match(move, /set status = 'reversed'/);
  // Corrections are append-only: this migration never rewrites one.
  assert.doesNotMatch(executable, /update public\.attendance_corrections|delete from public\.attendance_corrections/);
});

test("presence reads every way someone can be recorded, and nothing twice", () => {
  const presence = body("attendance_presence");
  assert.match(presence, /from public\.attendance_records r\s+join public\.attendance_entries e/);
  assert.match(presence, /e\.status = 'present'/);
  assert.match(presence, /f\.status = 'active'/);
  // Backfilled facts are copies of weekly entries.
  assert.match(presence, /f\.source <> 'legacy'/);
  // Saying you are coming is not coming.
  assert.match(presence, /s\.status in \('checked_in', 'checked_out'\)/);
  for (const [source, method] of [
    ["geofence", "automatic"],
    ["qr", "scanned"],
    ["kiosk", "kiosk"],
  ]) {
    assert.match(presence, new RegExp(`when '${source}' then '${method}'`));
  }
});
