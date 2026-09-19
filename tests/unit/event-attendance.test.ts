import assert from "node:assert/strict";
import test from "node:test";

import { eventAttendanceSchema } from "@/lib/attendance/v2/event-attendance";

const valid = {
  enabled: true,
  calendarEventId: "calendar-event-1",
  calendarId: "primary",
  calendarSource: "google" as const,
  title: "Community dinner",
  startAt: "2026-10-03T22:00:00.000Z",
  endAt: "2026-10-04T00:00:00.000Z",
  campusId: "11111111-1111-4111-8111-111111111111",
  automaticEnabled: true,
  codeEnabled: false,
  kioskEnabled: true,
  checkinOpensMinutesBefore: 30,
  checkinClosesMinutesAfter: 60,
};

test("an individual timed event can opt into attendance methods", () => {
  const parsed = eventAttendanceSchema.parse(valid);
  assert.equal(parsed.automaticEnabled, true);
  assert.equal(parsed.kioskEnabled, true);
  assert.equal(parsed.checkinOpensMinutesBefore, 30);
});

test("all-day events need an exact time before attendance can be counted", () => {
  const parsed = eventAttendanceSchema.safeParse({ ...valid, allDay: true });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.match(parsed.error.issues[0]!.message, /exact start and end/i);
});

test("attendance requires an end time and a non-empty check-in window", () => {
  assert.equal(eventAttendanceSchema.safeParse({ ...valid, endAt: null }).success, false);
  assert.equal(
    eventAttendanceSchema.safeParse({
      ...valid,
      checkinOpensMinutesBefore: 0,
      checkinClosesMinutesAfter: 0,
    }).success,
    false,
  );
});

test("an event that does not count attendance does not need attendance details", () => {
  const parsed = eventAttendanceSchema.safeParse({
    ...valid,
    enabled: false,
    endAt: null,
    allDay: true,
  });
  assert.equal(parsed.success, true);
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEventAttendanceDetails } from "@/lib/attendance/v2/event-attendance";
import { VisitorError } from "@/lib/faithform/errors";

function createMockSupabase(existingRow: Record<string, unknown> | null) {
  let updatedData: Record<string, unknown> | null = null;
  let auditData: Record<string, unknown> | null = null;

  const client = {
    from(table: string) {
      if (table === "service_occurrences") {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              async maybeSingle() {
                return { data: existingRow, error: null };
              },
            };
          },
          update(patch: Record<string, unknown>) {
            updatedData = patch;
            return {
              eq() {
                return this;
              },
              select() {
                return {
                  async single() {
                    return { data: { ...existingRow, ...updatedData }, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "event_attendance_setup_events") {
        return {
          async insert(payload: Record<string, unknown>) {
            auditData = payload;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    getUpdated: () => updatedData,
    getAudit: () => auditData,
  };
}

test("syncing calendar edits shifts the check-in window proportionally with the new start time", async () => {
  // Existing event starts in future at 22:00 UTC, check-in opens 30m before (21:30), closes 60m after (23:00)
  const existing = {
    id: "occ-1",
    church_id: "church-1",
    calendar_event_id: "cal-evt-1",
    starts_at_utc: "2026-10-03T22:00:00.000Z",
    ends_at_utc: "2026-10-03T23:30:00.000Z",
    checkin_opens_at_utc: "2026-10-03T21:30:00.000Z",
    checkin_closes_at_utc: "2026-10-03T23:00:00.000Z",
    timezone: "UTC",
    status: "scheduled",
    policy_snapshot: { sources: { geofence: true } },
  };

  const { client, getUpdated, getAudit } = createMockSupabase(existing);

  // Moved 2 hours later
  await syncEventAttendanceDetails({
    churchId: "church-1",
    actorUserId: "user-1",
    calendarEventId: "cal-evt-1",
    calendarId: "primary",
    calendarSource: "google",
    title: "Rescheduled Dinner",
    startAt: "2026-10-04T00:00:00.000Z",
    endAt: "2026-10-04T01:30:00.000Z",
    client,
  });

  const updated = getUpdated();
  assert.ok(updated);
  assert.equal(updated!.label, "Rescheduled Dinner");
  assert.equal(updated!.starts_at_utc, "2026-10-04T00:00:00.000Z");
  assert.equal(updated!.ends_at_utc, "2026-10-04T01:30:00.000Z");
  // Check-in opens 30 minutes before 00:00 => 23:30
  assert.equal(updated!.checkin_opens_at_utc, "2026-10-03T23:30:00.000Z");
  // Check-in closes 60 minutes after 00:00 => 01:00
  assert.equal(updated!.checkin_closes_at_utc, "2026-10-04T01:00:00.000Z");

  const audit = getAudit();
  assert.ok(audit);
  assert.equal(audit!.action, "updated");
});

test("syncing calendar edits rejects time changes once check-in has opened", async () => {
  // Checkin opened in the past
  const existing = {
    id: "occ-2",
    church_id: "church-1",
    calendar_event_id: "cal-evt-2",
    starts_at_utc: "2026-09-18T10:00:00.000Z",
    ends_at_utc: "2026-09-18T11:00:00.000Z",
    checkin_opens_at_utc: "2026-09-18T09:30:00.000Z",
    checkin_closes_at_utc: "2026-09-18T10:30:00.000Z",
    timezone: "UTC",
    status: "scheduled",
    policy_snapshot: {},
  };

  const { client } = createMockSupabase(existing);

  await assert.rejects(
    async () => {
      await syncEventAttendanceDetails({
        churchId: "church-1",
        actorUserId: "user-1",
        calendarEventId: "cal-evt-2",
        calendarId: "primary",
        calendarSource: "google",
        title: "Moved Dinner",
        startAt: "2026-09-19T10:00:00.000Z",
        endAt: "2026-09-19T11:00:00.000Z",
        client,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof VisitorError);
      assert.equal(err.code, "conflict");
      assert.match(err.message, /check-in has already opened/i);
      return true;
    },
  );
});

test("changing title without changing times does not conflict even after check-in opened", async () => {
  const existing = {
    id: "occ-3",
    church_id: "church-1",
    calendar_event_id: "cal-evt-3",
    starts_at_utc: "2026-09-18T10:00:00.000Z",
    ends_at_utc: "2026-09-18T11:00:00.000Z",
    checkin_opens_at_utc: "2026-09-18T09:30:00.000Z",
    checkin_closes_at_utc: "2026-09-18T10:30:00.000Z",
    timezone: "UTC",
    status: "scheduled",
    policy_snapshot: {},
  };

  const { client, getUpdated } = createMockSupabase(existing);

  await syncEventAttendanceDetails({
    churchId: "church-1",
    actorUserId: "user-1",
    calendarEventId: "cal-evt-3",
    calendarId: "primary",
    calendarSource: "google",
    title: "Updated Title Only",
    startAt: "2026-09-18T10:00:00.000Z",
    endAt: "2026-09-18T11:00:00.000Z",
    client,
  });

  const updated = getUpdated();
  assert.ok(updated);
  assert.equal(updated!.label, "Updated Title Only");
});

test("disabled or cancelled attendance occurrences are ignored during sync", async () => {
  const existing = {
    id: "occ-4",
    church_id: "church-1",
    calendar_event_id: "cal-evt-4",
    starts_at_utc: "2026-09-18T10:00:00.000Z",
    ends_at_utc: "2026-09-18T11:00:00.000Z",
    checkin_opens_at_utc: "2026-09-18T09:30:00.000Z",
    checkin_closes_at_utc: "2026-09-18T10:30:00.000Z",
    timezone: "UTC",
    status: "cancelled",
    policy_snapshot: {},
  };

  const { client, getUpdated } = createMockSupabase(existing);

  await syncEventAttendanceDetails({
    churchId: "church-1",
    actorUserId: "user-1",
    calendarEventId: "cal-evt-4",
    calendarId: "primary",
    calendarSource: "google",
    title: "Cancelled Event Rescheduled",
    startAt: "2026-10-01T10:00:00.000Z",
    endAt: "2026-10-01T11:00:00.000Z",
    client,
  });

  assert.equal(getUpdated(), null);
});


