import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Migration 0074 against real Postgres: a church can set automatic attendance
 * up, and its upcoming services follow what it sets.
 *
 * Every case here was a way automatic attendance could not work for a church
 * using only the dashboard:
 *
 *   - a church-wide service time snapshotted no campus position, so every
 *     geofence attempt banded `unknown` and was refused;
 *   - a policy switched on after generation stayed off for up to sixty days;
 *   - a moved service time left its old services standing beside the new ones;
 *   - a service time deleted, re-added and deleted again failed to save.
 *
 * Plus the two retention functions: expired detections are purged, and
 * withdrawing consent removes pending evidence without touching counted facts.
 *
 *   FAITHFORM_TEST_DATABASE_URL=postgres://…  pnpm test:concurrency
 *
 * Each test builds its own church under a fresh uuid and deletes it afterwards.
 */

const DATABASE_URL = process.env.FAITHFORM_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFORM_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "Migration 0074's refresh and retention functions are UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run database tests against a production-looking database");
}

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

/** A UTC midnight `days` from now, as a date string and a Date. */
function dayFromNow(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type Church = { churchId: string; campusId: string | null };

async function church(
  client: Client,
  input: { campus?: "primary" | "only" | "none" | "two-without-primary" } = {},
): Promise<Church> {
  const churchId = randomUUID();
  await client.query(
    `insert into public.churches (id, name, slug, timezone) values ($1, 'Setup Test', $2, 'America/Chicago')`,
    [churchId, `setup-${churchId.slice(0, 8)}`],
  );

  const kind = input.campus ?? "primary";
  if (kind === "none") return { churchId, campusId: null };

  const campusId = randomUUID();
  await client.query(
    `insert into public.church_campuses
       (id, church_id, name, slug, latitude, longitude, timezone, geofence_radius_m, is_active, is_public, is_primary)
     values ($1, $2, 'Main', 'main', 38.252700, -85.758500, 'America/New_York', 150, true, true, $3)`,
    [campusId, churchId, kind === "primary"],
  );

  if (kind === "two-without-primary") {
    await client.query(
      `insert into public.church_campuses
         (church_id, name, slug, latitude, longitude, timezone, geofence_radius_m, is_active, is_public, is_primary)
       values ($1, 'East', 'east', 38.200000, -85.600000, 'America/New_York', 150, true, true, false)`,
      [churchId],
    );
  }

  return { churchId, campusId };
}

async function serviceTime(
  client: Client,
  churchId: string,
  input: { label?: string; dayOfWeek: number; start: string; end?: string | null; campusId?: string | null },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into public.church_service_times (id, church_id, campus_id, label, day_of_week, start_time, end_time)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, churchId, input.campusId ?? null, input.label ?? "Worship", input.dayOfWeek, input.start, input.end ?? null],
  );
  return id;
}

async function generate(client: Client, churchId: string, fromDays = 1, toDays = 21) {
  const { rows } = await client.query(
    `select * from public.generate_service_occurrences($1, $2::date, $3::date)`,
    [churchId, dayFromNow(fromDays), dayFromNow(toDays)],
  );
  return rows[0];
}

async function refresh(client: Client, churchId: string, now?: string) {
  const { rows } = await client.query(
    `select * from public.refresh_upcoming_service_occurrences($1, coalesce($2::timestamptz, now()))`,
    [churchId, now ?? null],
  );
  return { refreshed: Number(rows[0].refreshed), retired: Number(rows[0].retired) };
}

async function occurrences(client: Client, churchId: string) {
  const { rows } = await client.query(
    `select id, label, status, campus_id, service_time_id, starts_at_utc, checkin_opens_at_utc,
            campus_latitude, campus_longitude, geofence_radius_m, policy_snapshot, cancellation_reason
       from public.service_occurrences
      where church_id = $1
      order by starts_at_utc, id`,
    [churchId],
  );
  return rows;
}

async function remove(client: Client, churchId: string) {
  await client.query(`delete from public.churches where id = $1`, [churchId]);
}

// ---------------------------------------------------------------------------
// Where a church-wide service happens
// ---------------------------------------------------------------------------

test("a church-wide service time is positioned at the main campus", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client, { campus: "primary" });
  try {
    await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00" });
    await generate(client, churchId);

    const rows = await occurrences(client, churchId);
    assert.ok(rows.length >= 2, "a three-week horizon holds at least two Sundays");
    for (const row of rows) {
      // Before 0074 these were null, and every geofence attempt banded `unknown`.
      assert.equal(row.campus_id, campusId);
      assert.equal(Number(row.campus_latitude), 38.2527);
      assert.equal(Number(row.campus_longitude), -85.7585);
      assert.equal(Number(row.geofence_radius_m), 150);
    }
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("a church whose only campus is not marked main still gets its position", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client, { campus: "only" });
  try {
    await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00" });
    await generate(client, churchId);
    const [first] = await occurrences(client, churchId);
    assert.equal(first.campus_id, campusId);
    assert.notEqual(first.campus_latitude, null);
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("several campuses and no main one is not guessed: the position stays empty", options, async () => {
  const client = await connect();
  const { churchId } = await church(client, { campus: "two-without-primary" });
  try {
    await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00" });
    await generate(client, churchId);
    const [first] = await occurrences(client, churchId);
    // Null fails closed: an attempt bands `unknown` rather than against the
    // wrong building.
    assert.equal(first.campus_id, null);
    assert.equal(first.campus_latitude, null);
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Upcoming services follow the setup
// ---------------------------------------------------------------------------

test("turning automatic check-in on reaches services already generated", options, async () => {
  const client = await connect();
  const { churchId } = await church(client);
  try {
    await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00", end: "11:00" });
    await generate(client, churchId);

    for (const row of await occurrences(client, churchId)) {
      assert.equal((row.policy_snapshot as { sources: { geofence: boolean } }).sources.geofence, false);
    }

    await client.query(
      `insert into public.attendance_policies (church_id, geofence_enabled, checkin_opens_minutes_before, min_dwell_seconds)
       values ($1, true, 45, 180)`,
      [churchId],
    );

    const first = await refresh(client, churchId);
    assert.ok(first.refreshed >= 2);

    for (const row of await occurrences(client, churchId)) {
      const snapshot = row.policy_snapshot as { sources: { geofence: boolean }; minDwellSeconds: number };
      assert.equal(snapshot.sources.geofence, true);
      assert.equal(snapshot.minDwellSeconds, 180);
      const opensBefore =
        (Date.parse(String(row.starts_at_utc)) - Date.parse(String(row.checkin_opens_at_utc))) / 60000;
      assert.equal(opensBefore, 45);
    }

    // Idempotent: nothing left to change.
    assert.deepEqual(await refresh(client, churchId), { refreshed: 0, retired: 0 });
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("a service whose check-in has opened keeps the snapshot it opened with", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client);
  try {
    const openId = randomUUID();
    await client.query(
      `insert into public.service_occurrences (
         id, church_id, campus_id, service_time_id, label, local_service_date, timezone,
         starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
         status, generation_source, policy_version, policy_snapshot
       ) values (
         $1, $2, $3, null, 'Open now', current_date, 'America/New_York',
         now() + interval '10 minutes', now() + interval '1 hour',
         now() - interval '20 minutes', now() + interval '2 hours',
         'scheduled', 'manual', 1,
         jsonb_build_object('sources', jsonb_build_object('geofence', false, 'manual', true, 'admin', true))
       )`,
      [openId, churchId, campusId],
    );
    await client.query(
      `insert into public.attendance_policies (church_id, geofence_enabled) values ($1, true)`,
      [churchId],
    );

    await refresh(client, churchId);

    const [row] = (await occurrences(client, churchId)).filter((r) => r.id === openId);
    // P6: a policy edited once attendance could begin does not change how that
    // service is judged.
    assert.equal((row.policy_snapshot as { sources: { geofence: boolean } }).sources.geofence, false);
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("setting a campus position after generation positions the upcoming services", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client);
  try {
    await client.query(
      `update public.church_campuses set latitude = null, longitude = null where id = $1`,
      [campusId],
    );
    await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00" });
    await generate(client, churchId);
    assert.equal((await occurrences(client, churchId))[0].campus_latitude, null);

    await client.query(
      `update public.church_campuses set latitude = 40.000001, longitude = -75.000002, geofence_radius_m = 220 where id = $1`,
      [campusId],
    );
    await refresh(client, churchId);

    for (const row of await occurrences(client, churchId)) {
      assert.equal(Number(row.campus_latitude), 40.000001);
      assert.equal(Number(row.campus_longitude), -75.000002);
      assert.equal(Number(row.geofence_radius_m), 220);
    }
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("a moved service time replaces its upcoming services instead of doubling them", options, async () => {
  const client = await connect();
  const { churchId } = await church(client);
  try {
    const id = await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00" });
    await generate(client, churchId);
    const before = await occurrences(client, churchId);

    await client.query(`update public.church_service_times set start_time = '11:30' where id = $1`, [id]);
    const result = await refresh(client, churchId);
    assert.equal(result.retired, before.length);
    await generate(client, churchId);

    const after = await occurrences(client, churchId);
    assert.equal(after.length, before.length, "one service per Sunday, not two");
    for (const row of after) {
      assert.equal(row.status, "scheduled");
      // 11:30 in Chicago.
      const local = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(String(row.starts_at_utc)));
      assert.equal(local, "11:30");
    }
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("a moved service time with history is cancelled, not deleted", options, async () => {
  const client = await connect();
  const { churchId } = await church(client);
  try {
    const id = await serviceTime(client, churchId, { dayOfWeek: 0, start: "10:00" });
    await generate(client, churchId);
    const [first] = await occurrences(client, churchId);

    // Someone tried to check in too early: an attempt row now references it.
    const { rows: members } = await client.query(
      `insert into public.members (church_id, first_name, last_name) values ($1, 'Early', 'Bird') returning id`,
      [churchId],
    );
    await client.query(
      `select * from public.record_attendance($1, $2, 'manual', 'staff', $3)`,
      [first.id, members[0].id, `early-${randomUUID()}`],
    );

    await client.query(`update public.church_service_times set start_time = '09:00' where id = $1`, [id]);
    await refresh(client, churchId);

    const { rows } = await client.query(
      `select status, cancellation_reason, service_time_id from public.service_occurrences where id = $1`,
      [first.id],
    );
    assert.equal(rows.length, 1, "an occurrence an attempt points at is never deleted");
    assert.equal(rows[0].status, "cancelled");
    assert.equal(rows[0].cancellation_reason, "schedule_changed");
    assert.equal(rows[0].service_time_id, null);
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("a deleted service time retires its upcoming services", options, async () => {
  const client = await connect();
  const { churchId } = await church(client);
  try {
    const id = await serviceTime(client, churchId, { dayOfWeek: 3, start: "19:00" });
    await generate(client, churchId);
    assert.ok((await occurrences(client, churchId)).length > 0);

    await client.query(`delete from public.church_service_times where id = $1`, [id]);
    await refresh(client, churchId);

    assert.equal((await occurrences(client, churchId)).length, 0);
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

test("deleting, re-adding and deleting the same service again does not fail", options, async () => {
  const client = await connect();
  const { churchId } = await church(client);
  try {
    // Past days included, so the orphans are ones refresh deliberately keeps.
    const first = await serviceTime(client, churchId, { label: "Evening", dayOfWeek: 0, start: "18:00" });
    await generate(client, churchId, -14, 7);
    await client.query(`delete from public.church_service_times where id = $1`, [first]);

    const second = await serviceTime(client, churchId, { label: "Evening", dayOfWeek: 0, start: "18:00" });
    await generate(client, churchId, -14, 7);

    // This delete collided with the first orphan on the manual-occurrence
    // index before 0074, and the website editor's save failed.
    await client.query(`delete from public.church_service_times where id = $1`, [second]);

    const { rows } = await client.query(
      `select starts_at_utc, count(*)::int as n
         from public.service_occurrences
        where church_id = $1
        group by starts_at_utc
       having count(*) > 1`,
      [churchId],
    );
    assert.deepEqual(rows, [], "a re-added service is re-attached, never duplicated");
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// The radius
// ---------------------------------------------------------------------------

test("the campus check-in radius is held between 50 and 500 metres", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client);
  try {
    for (const radius of [25, 49, 501, 2000]) {
      await assert.rejects(
        client.query(`update public.church_campuses set geofence_radius_m = $1 where id = $2`, [radius, campusId]),
        /geofence_radius_m_check/,
        `radius ${radius}`,
      );
    }
    for (const radius of [50, 500]) {
      await client.query(`update public.church_campuses set geofence_radius_m = $1 where id = $2`, [radius, campusId]);
    }
  } finally {
    await remove(client, churchId);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Retention and consent
// ---------------------------------------------------------------------------

type Visitor = { accountId: string; memberId: string; occurrenceId: string };

async function visitorAtOpenService(client: Client, churchId: string, campusId: string): Promise<Visitor> {
  const occurrenceId = randomUUID();
  await client.query(
    `insert into public.service_occurrences (
       id, church_id, campus_id, service_time_id, label, local_service_date, timezone,
       starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
       status, generation_source, policy_version, policy_snapshot,
       campus_latitude, campus_longitude, geofence_radius_m
     ) values (
       $1, $2, $3, null, 'Live', current_date, 'America/New_York',
       now() - interval '5 minutes', now() + interval '1 hour',
       now() - interval '30 minutes', now() + interval '2 hours',
       'active', 'manual', 1,
       jsonb_build_object(
         'sources', jsonb_build_object('manual', true, 'admin', true, 'geofence', true),
         'maxLocationAccuracyM', 100, 'minDwellSeconds', 120, 'requiresConfirmation', true
       ),
       38.2527, -85.7585, 150
     )`,
    [occurrenceId, churchId, campusId],
  );

  const { rows: users } = await client.query(`insert into auth.users (email) values (null) returning id`);
  const { rows: accounts } = await client.query(
    `insert into public.visitor_accounts (user_id, auto_attendance_consent) values ($1, 'granted') returning id`,
    [users[0].id],
  );
  const { rows: members } = await client.query(
    `insert into public.members (church_id, first_name, last_name) values ($1, 'Linked', 'Visitor') returning id`,
    [churchId],
  );
  return { accountId: accounts[0].id as string, memberId: members[0].id as string, occurrenceId };
}

async function removeVisitor(client: Client, visitor: Visitor) {
  await client.query(
    `delete from auth.users where id = (select user_id from public.visitor_accounts where id = $1)`,
    [visitor.accountId],
  );
}

test("expired detections are purged and live ones are kept", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client);
  const visitor = await visitorAtOpenService(client, churchId, campusId as string);
  try {
    const open = async (attempt: string) =>
      (
        await client.query(
          `select detection_id from public.open_attendance_detection($1, $2, $3, $4)`,
          [visitor.occurrenceId, visitor.memberId, visitor.accountId, attempt],
        )
      ).rows[0].detection_id as string;

    const live = await open("live-attempt");
    const stale = await open("stale-attempt");
    await client.query(
      `update public.attendance_detections set expires_at = now() - interval '1 minute' where id = $1`,
      [stale],
    );

    const { rows } = await client.query(`select public.purge_expired_attendance_detections() as removed`);
    assert.ok(Number(rows[0].removed) >= 1);

    const { rows: left } = await client.query(
      `select id from public.attendance_detections where id = any($1::uuid[])`,
      [[live, stale]],
    );
    assert.deepEqual(left.map((row) => row.id), [live]);
  } finally {
    await removeVisitor(client, visitor);
    await remove(client, churchId);
    await client.end();
  }
});

test("withdrawing consent removes pending evidence and leaves counted attendance alone", options, async () => {
  const client = await connect();
  const { churchId, campusId } = await church(client);
  const visitor = await visitorAtOpenService(client, churchId, campusId as string);
  try {
    await client.query(
      `select * from public.open_attendance_detection($1, $2, $3, 'pending-attempt')`,
      [visitor.occurrenceId, visitor.memberId, visitor.accountId],
    );
    const { rows: pending } = await client.query(
      `select * from public.record_attendance($1, $2, 'geofence', 'visitor', 'gf-pending', $3, null, null, 'inside', 'high', 0)`,
      [visitor.occurrenceId, visitor.memberId, visitor.accountId],
    );
    assert.equal(pending[0].outcome, "pending_confirmation");

    // A second service the same account was already counted at.
    const counted = await visitorAtOpenService(client, churchId, campusId as string);
    await client.query(
      `select * from public.record_attendance($1, $2, 'geofence', 'visitor', 'gf-counted', $3, null, null, 'inside', 'high', 600)`,
      [counted.occurrenceId, visitor.memberId, visitor.accountId],
    );

    const { rows } = await client.query(
      `select * from public.withdraw_automatic_attendance_evidence($1)`,
      [visitor.accountId],
    );
    assert.equal(Number(rows[0].detections_removed), 1);
    assert.equal(Number(rows[0].attempts_closed), 1);

    const { rows: detections } = await client.query(
      `select count(*)::int as n from public.attendance_detections where account_id = $1`,
      [visitor.accountId],
    );
    assert.equal(detections[0].n, 0);

    const { rows: attempts } = await client.query(
      `select idempotency_key, status, result_reason from public.attendance_attempts
        where account_id = $1 order by idempotency_key`,
      [visitor.accountId],
    );
    assert.deepEqual(
      attempts.map((row) => [row.idempotency_key, row.status, row.result_reason]),
      [
        ["gf-counted", "counted", "ok"],
        ["gf-pending", "expired", "consent_revoked"],
      ],
    );

    const { rows: facts } = await client.query(
      `select status from public.attendance_facts where member_id = $1`,
      [visitor.memberId],
    );
    assert.deepEqual(facts.map((row) => row.status), ["active"]);

    await removeVisitor(client, counted);
  } finally {
    await removeVisitor(client, visitor);
    await remove(client, churchId);
    await client.end();
  }
});
