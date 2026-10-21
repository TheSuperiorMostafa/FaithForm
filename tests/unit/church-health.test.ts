import assert from "node:assert/strict";
import test from "node:test";
import { churchHealth, type ChurchHealthSignals } from "@/lib/admin/church-health";

const now = new Date("2026-10-21T12:00:00Z");
const created = "2026-09-01T00:00:00Z";
const active: ChurchHealthSignals = { recent_days: 3, previous_days: 3, last_seen_at: now.toISOString(), open_tickets: 0, health_override: null, health_note: null };
test("multiple staff visits per week are green; quiet and declining churches are yellow", () => {
  assert.equal(churchHealth(active, created, now).status, "green");
  assert.equal(churchHealth({ ...active, recent_days: 1 }, created, now).status, "yellow");
  assert.equal(churchHealth({ ...active, recent_days: 2, previous_days: 6 }, created, now).status, "yellow");
});
test("support and stopped usage remain red even if a manual watch flag exists", () => {
  assert.equal(churchHealth({ ...active, open_tickets: 1 }, created, now).status, "red");
  assert.equal(churchHealth({ ...active, last_seen_at: "2026-10-07T12:00:00Z", health_override: "yellow" }, created, now).status, "red");
});
test("manual risk records reasons; newly created churches are not called abandoned", () => {
  assert.deepEqual(churchHealth({ ...active, health_override: "red", health_note: "Pastor requested help" }, created, now), { status: "red", reason: "Pastor requested help", manual: true });
  assert.equal(churchHealth({ ...active, recent_days: 0, last_seen_at: null }, now.toISOString(), now).status, "yellow");
  assert.equal(churchHealth({ ...active, recent_days: 0, last_seen_at: null }, created, now).status, "red");
  assert.equal(churchHealth(null, created, now).status, "unknown");
});
