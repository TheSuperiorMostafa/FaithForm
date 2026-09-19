import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Migrations 0091 (Groups) and 0092 (group messaging), read as text.
 *
 * `tests/database/groups*.test.ts` executes them against the whole chain; this
 * pins the properties that must hold however they are later edited, and runs
 * in the ordinary `pnpm test` without a database.
 */

const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/--.*$/gm, "")
    .toLowerCase();

const groups = code("supabase/migrations/0091_groups.sql");
const messaging = code("supabase/migrations/0092_group_messaging.sql");

function createdTables(sql: string): string[] {
  return [...sql.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
}

test("every table either migration creates has row level security and starts from nothing", () => {
  for (const sql of [groups, messaging]) {
    const tables = createdTables(sql);
    assert.ok(tables.length >= 10, "the sweep found the tables");
    for (const table of tables) {
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${table} has RLS`);
      assert.match(
        sql,
        new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`),
        `${table} revokes the default grants`,
      );
    }
  }
});

test("no browser role is given a write path, and reads are staff-of-the-church only", () => {
  for (const sql of [groups, messaging]) {
    assert.doesNotMatch(sql, /for (insert|update|delete|all) to authenticated/);
    assert.doesNotMatch(sql, /to anon/);
    assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to authenticated/);
    for (const policy of sql.matchAll(/create policy [a-z_]+ on public\.[a-z_]+\s+for select to authenticated using \(([^;]*)\);/g)) {
      assert.match(policy[1], /public\.has_groups_access\(church_id\)/, "every read is gated on the Groups feature");
    }
  }
  // Invitations and every messaging binding, job and personal record are the
  // server's alone.
  assert.doesNotMatch(groups, /grant select[^;]*group_invitations[^;]*to authenticated/);
  for (const table of [
    "messaging_user_bindings", "group_chat_bindings", "messaging_dm_channels",
    "messaging_notification_preferences", "messaging_blocks", "messaging_sync_jobs",
    "messaging_webhook_receipts",
  ]) {
    const grantToBrowsers = /grant select on table([\s\S]*?)to authenticated;/.exec(messaging)?.[1] ?? "";
    assert.ok(!grantToBrowsers.includes(`public.${table}`), `${table} is not readable by browsers`);
  }
});

test("the Groups access helper is the feature check, not bare staff membership", () => {
  assert.match(groups, /create or replace function public\.has_groups_access[\s\S]*?user_has_feature\(target_church_id, 'groups'\)/);
});

test("every command is server-only", () => {
  const commands = [
    "group_join", "group_accept_invitation", "group_leave", "group_decide_request",
    "group_add_member", "group_remove_member", "group_set_role", "record_group_attendance",
    "ensure_group_event_occurrence", "generate_group_events", "discover_groups",
    "group_church_summary", "connect_group_member_people",
  ];
  for (const name of commands) {
    assert.match(groups, new RegExp(`'public\\.${name}\\(`), `${name} is in the revoke list`);
  }
  assert.match(groups, /revoke all on function %s from public, anon, authenticated/);
  for (const name of ["enqueue_messaging_sync", "claim_messaging_sync_jobs", "complete_messaging_sync_job"]) {
    assert.match(messaging, new RegExp(`'public\\.${name}\\(`));
  }
});

test("defaults are the safe ones", () => {
  assert.match(messaging, /dm_policy text not null default 'disabled'/, "direct messages start off");
  assert.match(groups, /location_visibility text not null default 'members'/, "a meeting address starts members-only");
  assert.match(groups, /safety_profile text not null default 'standard'/);
  assert.match(groups, /status text not null default 'active'/);
});

test("a gathering's occurrence accepts only manual and admin attendance", () => {
  assert.match(
    groups,
    /'manual', true, 'admin', true, 'geofence', false, 'qr', false, 'kiosk', false/,
  );
  assert.match(groups, /'group', 1,/, "generated as a group occurrence");
  // Excluded from the manual identity, identified by the gathering instead.
  assert.match(groups, /and group_id is null;/);
  assert.match(groups, /create unique index if not exists service_occurrences_group_event_idx/);
});

test("attendance goes through the one command and the one correction", () => {
  const body = /create or replace function public\.record_group_attendance[\s\S]*?\$\$;/.exec(groups)?.[0] ?? "";
  assert.match(body, /public\.record_attendance\(/);
  assert.match(body, /public\.correct_attendance\(/);
  assert.doesNotMatch(body, /insert into public\.attendance_facts/, "never a second insert path");
  assert.doesNotMatch(body, /update public\.attendance_facts/);
});

test("neither migration deletes history or drops anything", () => {
  for (const sql of [groups, messaging]) {
    assert.doesNotMatch(sql, /delete\s+from\s+public\.(attendance_facts|attendance_attempts|attendance_corrections|members)/);
    assert.doesNotMatch(sql, /\btruncate\b/);
    assert.doesNotMatch(sql, /drop table/);
  }
});

test("a job never carries a secret or content", () => {
  const payloads = [...messaging.matchAll(/jsonb_build_object\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(payloads.length >= 2);
  for (const payload of payloads) {
    assert.doesNotMatch(payload, /token|secret|text|body|message/);
  }
});

test("joining is serialized on the group row", () => {
  for (const fn of ["group_join", "group_decide_request", "group_add_member"]) {
    const body = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`).exec(groups)?.[0] ?? "";
    assert.match(body, /from public\.groups where id = [^;]*for update/, `${fn} locks the group`);
  }
});
