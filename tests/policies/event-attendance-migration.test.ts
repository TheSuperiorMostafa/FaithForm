import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/0089_event_attendance.sql", "utf8").toLowerCase();

test("calendar-event attendance has a tenant-scoped stable identity", () => {
  assert.match(sql, /church_id,\s*calendar_source,\s*calendar_id,\s*calendar_event_id/);
  assert.match(sql, /calendar_source in \('google', 'apple'\)/);
});

test("event attendance setup has a service-role-only audit trail", () => {
  assert.match(sql, /create table if not exists public\.event_attendance_setup_events/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.event_attendance_setup_events\s+from public, anon, authenticated/);
  assert.match(sql, /grant all on table public\.event_attendance_setup_events to service_role/);
});

test("the migration never deletes attendance facts or attempts", () => {
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(attendance_facts|attendance_attempts)/);
  assert.doesNotMatch(sql, /truncate/);
  assert.doesNotMatch(sql, /drop\s+table/);
});

