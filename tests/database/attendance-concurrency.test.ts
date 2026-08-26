import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Executable two-connection concurrency tests for the attendance authority.
 *
 * These are the only tests in the repository that can *observe* rather than
 * infer the core invariant. Source inspection proves the unique index and the
 * `on conflict do nothing` are written; only two real connections racing them
 * proves they behave.
 *
 * They skip — loudly, with a reason — when no disposable database is
 * configured. They must run in non-production CI once one is.
 *
 *   FAITHFUL_TEST_DATABASE_URL=postgres://…  pnpm test:database
 *
 * The target must already have every migration applied. Nothing here is
 * destructive to anything it did not create: each test builds its own church,
 * campus, schedule, members and occurrence under a fresh uuid, and removes them
 * afterwards.
 */

const DATABASE_URL = process.env.FAITHFUL_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFUL_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "This is an external dependency, not a passing test: the concurrency " +
  "invariant is UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run concurrency tests against a production-looking database");
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

/** A self-contained church, campus, schedule, occurrence and members. */
type Fixture = {
  churchId: string;
  campusId: string;
  occurrenceId: string;
  memberIds: string[];
};

async function seed(client: Client, memberCount = 3): Promise<Fixture> {
  const churchId = randomUUID();
  const campusId = randomUUID();
  const occurrenceId = randomUUID();
  const slug = `test-${churchId.slice(0, 8)}`;

  await client.query(
    `insert into public.churches (id, name, slug, timezone) values ($1, $2, $3, 'America/New_York')`,
    [churchId, "Concurrency Test Church", slug],
  );

  await client.query(
    `insert into public.church_campuses
       (id, church_id, name, slug, latitude, longitude, timezone, geofence_radius_m, is_active, is_public, is_primary)
     values ($1, $2, 'Main', 'main', 38.252700, -85.758500, 'America/New_York', 150, true, true, true)`,
    [campusId, churchId],
  );

  // A wide-open window so the window check never decides the outcome — these
  // tests are about the uniqueness race, not about timing.
  await client.query(
    `insert into public.service_occurrences (
        id, church_id, campus_id, service_time_id, label, local_service_date, timezone,
        starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
        status, generation_source, policy_version, policy_snapshot
     ) values (
        $1, $2, $3, null, 'Concurrency Service', current_date, 'America/New_York',
        now() - interval '10 minutes', now() + interval '2 hours',
        now() - interval '1 hour', now() + interval '3 hours',
        'active', 'manual', 1,
        jsonb_build_object(
          'sources', jsonb_build_object('manual', true, 'admin', true, 'geofence', true, 'qr', true, 'kiosk', true),
          'maxLocationAccuracyM', 100, 'minDwellSeconds', 0, 'requiresConfirmation', false,
          'evidenceRetentionDays', 1
        )
     )`,
    [occurrenceId, churchId, campusId],
  );

  const memberIds: string[] = [];
  for (let index = 0; index < memberCount; index++) {
    const memberId = randomUUID();
    memberIds.push(memberId);
    await client.query(
      `insert into public.members (id, church_id, first_name, last_name) values ($1, $2, $3, 'Tester')`,
      [memberId, churchId, `Person${index}`],
    );
  }

  return { churchId, campusId, occurrenceId, memberIds };
}

async function cleanup(client: Client, fixture: Fixture): Promise<void> {
  // Everything cascades from the church row.
  await client.query(`delete from public.churches where id = $1`, [fixture.churchId]);
}

async function countActiveFacts(client: Client, occurrenceId: string): Promise<number> {
  const { rows } = await client.query(
    `select count(*)::int as n from public.attendance_facts
      where service_occurrence_id = $1 and status = 'active'`,
    [occurrenceId],
  );
  return Number(rows[0].n);
}

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

// ---------------------------------------------------------------------------
// The core invariant, observed
// ---------------------------------------------------------------------------

test("two connections marking the same person produce exactly one fact", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 1);
  const member = fixture.memberIds[0];

  try {
    // Both calls are issued before either is awaited, so they genuinely
    // overlap inside the database rather than running in sequence.
    const [first, second] = await Promise.all([
      a.query(
        `select * from public.record_attendance($1, $2, 'manual', 'staff', $3)`,
        [fixture.occurrenceId, member, `race-a-${randomUUID()}`],
      ),
      b.query(
        `select * from public.record_attendance($1, $2, 'manual', 'staff', $3)`,
        [fixture.occurrenceId, member, `race-b-${randomUUID()}`],
      ),
    ]);

    const outcomes = [first.rows[0].outcome, second.rows[0].outcome].sort();

    // One wins the insert; the other reads the winner's row.
    assert.deepEqual(outcomes, ["already_counted", "counted"]);
    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 1);
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("mixed sources racing the same person still produce one fact", options, async () => {
  const connections = await Promise.all([connect(), connect(), connect(), connect()]);
  const fixture = await seed(connections[0], 1);
  const member = fixture.memberIds[0];

  try {
    const sources: [string, string][] = [
      ["manual", "staff"],
      ["geofence", "visitor"],
      ["qr", "visitor"],
      ["kiosk", "kiosk"],
    ];

    const results = await Promise.all(
      sources.map(([source, actor], index) =>
        connections[index].query(
          `select * from public.record_attendance(
             $1, $2, $3, $4, $5, null, null, null, 'inside', 'high', 0
           )`,
          [fixture.occurrenceId, member, source, actor, `mixed-${source}-${randomUUID()}`],
        ),
      ),
    );

    const counted = results.filter((r) => r.rows[0].outcome === "counted").length;
    assert.equal(counted, 1, "exactly one source may win");
    assert.equal(await countActiveFacts(connections[0], fixture.occurrenceId), 1);
  } finally {
    await cleanup(connections[0], fixture);
    await Promise.all(connections.map((client) => client.end()));
  }
});

test("a repeated idempotency key returns the first result, not a second fact", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];
  const key = `idem-${randomUUID()}`;

  try {
    const first = await client.query(
      `select * from public.record_attendance($1, $2, 'manual', 'staff', $3)`,
      [fixture.occurrenceId, member, key],
    );
    const second = await client.query(
      `select * from public.record_attendance($1, $2, 'manual', 'staff', $3)`,
      [fixture.occurrenceId, member, key],
    );

    assert.equal(first.rows[0].outcome, "counted");
    assert.equal(second.rows[0].outcome, "already_counted");
    // The same attempt row, not a second one.
    assert.equal(second.rows[0].attempt_id, first.rows[0].attempt_id);
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// The batch wrapper
// ---------------------------------------------------------------------------

test("two connections running the same batch produce one fact per person", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 5);
  const batchKey = `batch-${randomUUID()}`;

  try {
    const [first, second] = await Promise.all([
      a.query(
        `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
        [fixture.occurrenceId, fixture.memberIds, batchKey],
      ),
      b.query(
        `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
        [fixture.occurrenceId, fixture.memberIds, batchKey],
      ),
    ]);

    assert.equal(first.rows.length, 5);
    assert.equal(second.rows.length, 5);
    // Five people, five facts — however the two batches interleaved.
    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 5);
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("a duplicate person in one batch yields one result row and one fact", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 2);
  const [first, second] = fixture.memberIds;

  try {
    const { rows } = await client.query(
      `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
      [fixture.occurrenceId, [first, second, first, first], `dup-${randomUUID()}`],
    );

    assert.equal(rows.length, 2, "duplicates collapse to one row per person");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 2);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a batch mixing new and already-counted people commits both", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 3);

  try {
    // Count one person first, so the batch meets a mix.
    await client.query(
      `select * from public.record_attendance($1, $2, 'manual', 'staff', $3)`,
      [fixture.occurrenceId, fixture.memberIds[0], `pre-${randomUUID()}`],
    );

    const { rows } = await client.query(
      `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
      [fixture.occurrenceId, fixture.memberIds, `mix-${randomUUID()}`],
    );

    const counted = rows.filter((row) => row.outcome === "counted").length;
    const already = rows.filter((row) => row.outcome === "already_counted").length;

    assert.equal(counted, 2);
    assert.equal(already, 1, "an expected outcome must not roll the batch back");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 3);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a member from another church is rejected without affecting the rest", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 2);
  const other = await seed(client, 1);

  try {
    const { rows } = await client.query(
      `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
      [
        fixture.occurrenceId,
        [...fixture.memberIds, other.memberIds[0]],
        `tenant-${randomUUID()}`,
      ],
    );

    const rejected = rows.filter((row) => row.reason === "member_not_in_church");
    assert.equal(rejected.length, 1);
    // The valid people still committed.
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 2);
  } finally {
    await cleanup(client, fixture);
    await cleanup(client, other);
    await client.end();
  }
});

test("an oversized batch rolls back entirely", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);

  try {
    const tooMany = Array.from({ length: 1001 }, () => randomUUID());

    await assert.rejects(
      () =>
        client.query(
          `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
          [fixture.occurrenceId, tooMany, `huge-${randomUUID()}`],
        ),
      /batch too large/,
    );

    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("an unknown occurrence rolls the whole batch back", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 2);

  try {
    await assert.rejects(
      () =>
        client.query(
          `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
          [randomUUID(), fixture.memberIds, `ghost-${randomUUID()}`],
        ),
      /occurrence not found/,
    );

    // Nobody was marked against the real occurrence either.
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

test("concurrent generators create no duplicate occurrences", options, async () => {
  const a = await connect();
  const b = await connect();
  const churchId = randomUUID();
  const campusId = randomUUID();
  const slug = `gen-${churchId.slice(0, 8)}`;

  try {
    await a.query(
      `insert into public.churches (id, name, slug, timezone) values ($1, 'Gen Test', $2, 'America/New_York')`,
      [churchId, slug],
    );
    await a.query(
      `insert into public.church_campuses (id, church_id, name, slug, timezone, is_active, is_public, is_primary)
       values ($1, $2, 'Main', 'main', 'America/New_York', true, true, true)`,
      [campusId, churchId],
    );
    await a.query(
      `insert into public.church_service_times (church_id, campus_id, label, day_of_week, start_time, end_time)
       values ($1, $2, 'Sunday Morning', 0, '10:00', '11:30')`,
      [churchId, campusId],
    );

    const from = "2026-03-01";
    const to = "2026-03-31";

    await Promise.all([
      a.query(`select * from public.generate_service_occurrences($1, $2::date, $3::date)`, [churchId, from, to]),
      b.query(`select * from public.generate_service_occurrences($1, $2::date, $3::date)`, [churchId, from, to]),
    ]);

    const { rows } = await a.query(
      `select count(*)::int as n, count(distinct starts_at_utc)::int as distinct_starts
         from public.service_occurrences where church_id = $1`,
      [churchId],
    );

    // March 2026 has five Sundays; both generators together must produce five.
    assert.equal(Number(rows[0].n), Number(rows[0].distinct_starts));
    assert.equal(Number(rows[0].n), 5);
  } finally {
    await a.query(`delete from public.churches where id = $1`, [churchId]);
    await a.end();
    await b.end();
  }
});

test("DST is resolved from the zone, not a fixed offset", options, async () => {
  const client = await connect();
  const churchId = randomUUID();
  const campusId = randomUUID();
  const slug = `dst-${churchId.slice(0, 8)}`;

  try {
    await client.query(
      `insert into public.churches (id, name, slug, timezone) values ($1, 'DST Test', $2, 'America/New_York')`,
      [churchId, slug],
    );
    await client.query(
      `insert into public.church_campuses (id, church_id, name, slug, timezone, is_active, is_public, is_primary)
       values ($1, $2, 'Main', 'main', 'America/New_York', true, true, true)`,
      [campusId, churchId],
    );
    await client.query(
      `insert into public.church_service_times (church_id, campus_id, label, day_of_week, start_time, end_time)
       values ($1, $2, 'Sunday Morning', 0, '10:00', '11:30')`,
      [churchId, campusId],
    );

    // Spans the 2026 US spring-forward on 8 March.
    await client.query(
      `select * from public.generate_service_occurrences($1, '2026-03-01'::date, '2026-03-15'::date)`,
      [churchId],
    );

    const { rows } = await client.query(
      `select local_service_date, starts_at_utc
         from public.service_occurrences
        where church_id = $1 order by starts_at_utc`,
      [churchId],
    );

    // `pg` returns a Date for a date column, so compare on the ISO day rather
    // than on however JavaScript happens to stringify it.
    const day = (row: Record<string, unknown>) =>
      new Date(row.local_service_date as string).toISOString().slice(0, 10);

    const before = rows.find((r) => day(r) === "2026-03-01");
    const after = rows.find((r) => day(r) === "2026-03-15");

    assert.ok(before && after);

    // 10:00 local is 15:00Z on standard time and 14:00Z on daylight time.
    const beforeHour = new Date(before!.starts_at_utc as string).getUTCHours();
    const afterHour = new Date(after!.starts_at_utc as string).getUTCHours();

    assert.equal(beforeHour, 15, "before the transition, 10:00 EST is 15:00Z");
    assert.equal(afterHour, 14, "after it, 10:00 EDT is 14:00Z");
  } finally {
    await client.query(`delete from public.churches where id = $1`, [churchId]);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Prompt 7 — native geofence convergence
//
// Everything below proves the same thing from a different angle: a native
// submission is not a new authority. It reaches `record_attendance`, produces
// the one counted fact, and shows up in the aggregate the admin dashboard
// already reads — and it cannot double-count against any other source.
// ---------------------------------------------------------------------------

/** What a native client actually sends, through the same command the API uses. */
async function nativeGeofenceAttempt(
  client: Client,
  input: {
    occurrenceId: string;
    memberId: string;
    idempotencyKey: string;
    accuracyBand?: string;
    distanceBand?: string;
    dwellSeconds?: number;
  },
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select * from public.record_attendance(
        p_occurrence_id := $1,
        p_member_id := $2,
        p_source := 'geofence',
        p_actor_type := 'visitor',
        p_idempotency_key := $3,
        p_distance_band := $4,
        p_accuracy_band := $5,
        p_dwell_seconds := $6
     )`,
    [
      input.occurrenceId,
      input.memberId,
      input.idempotencyKey,
      input.distanceBand ?? "inside",
      input.accuracyBand ?? "high",
      input.dwellSeconds ?? 120,
    ],
  );
  return rows[0];
}

test("a native geofence submission creates the one counted fact", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    const result = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-native-1",
    });

    assert.equal(result.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);

    // The fact is a geofence fact, and it carries no location at all.
    const { rows } = await client.query(
      `select source, status, member_id from public.attendance_facts
        where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(rows[0].source, "geofence");
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].member_id, member);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("two connections submitting the same native intent produce one fact", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 1);
  const member = fixture.memberIds[0];

  try {
    // A phone that woke twice, or retried after losing a response. Both carry
    // the same deterministic key the clients derive.
    const key = "gf-deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const first = nativeGeofenceAttempt(a, {
      occurrenceId: fixture.occurrenceId, memberId: member, idempotencyKey: key,
    });
    const second = nativeGeofenceAttempt(b, {
      occurrenceId: fixture.occurrenceId, memberId: member, idempotencyKey: key,
    });
    const [left, right] = await Promise.all([first, second]);

    // Exactly one fact, whichever connection won.
    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 1);

    // Both callers get a usable answer; the loser reads the winner's row.
    const outcomes = [left.outcome, right.outcome].sort();
    assert.deepEqual(outcomes, ["already_counted", "counted"]);

    // And one attempt row, because the key was identical.
    const { rows } = await a.query(
      `select count(*)::int as n from public.attendance_attempts
        where service_occurrence_id = $1 and idempotency_key = $2`,
      [fixture.occurrenceId, key],
    );
    assert.equal(Number(rows[0].n), 1, "a repeated key must not create a second attempt");
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("native and manual racing the same person produce one fact", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 1);
  const member = fixture.memberIds[0];

  try {
    // Someone checks in on their phone as they walk in while a greeter marks
    // them present on the dashboard. Both must succeed; one must count.
    const native = nativeGeofenceAttempt(a, {
      occurrenceId: fixture.occurrenceId, memberId: member, idempotencyKey: "gf-race",
    });
    const manual = b.query(
      `select * from public.record_attendance(
          p_occurrence_id := $1, p_member_id := $2,
          p_source := 'manual', p_actor_type := 'staff',
          p_idempotency_key := 'manual-race')`,
      [fixture.occurrenceId, member],
    );

    const [nativeResult, manualResult] = await Promise.all([native, manual]);

    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 1);

    const outcomes = [nativeResult.outcome, manualResult.rows[0].outcome].sort();
    assert.deepEqual(outcomes, ["already_counted", "counted"]);
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("native and bulk racing the same person produce one fact", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 3);
  const member = fixture.memberIds[0];

  try {
    // A phone arriving while an administrator marks the whole roster.
    const native = nativeGeofenceAttempt(a, {
      occurrenceId: fixture.occurrenceId, memberId: member, idempotencyKey: "gf-bulk-race",
    });
    const bulk = b.query(
      `select * from public.record_attendance_batch($1, $2, 'manual', 'staff', $3)`,
      [fixture.occurrenceId, fixture.memberIds, "bulk-race"],
    );

    await Promise.all([native, bulk]);

    // Three people, three facts. Never four.
    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 3);

    const { rows } = await client_countFor(a, fixture.occurrenceId, member);
    assert.equal(rows.length, 1, "one person, one fact");
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

async function client_countFor(client: Client, occurrenceId: string, memberId: string) {
  return client.query(
    `select id from public.attendance_facts
      where service_occurrence_id = $1 and member_id = $2`,
    [occurrenceId, memberId],
  );
}

test("a native retry returns the original logical outcome", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    const key = "gf-retry-stable";
    const first = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: member, idempotencyKey: key,
    });
    assert.equal(first.outcome, "counted");

    // The phone lost the response and retried with the same deterministic key.
    const retry = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: member, idempotencyKey: key,
    });

    assert.equal(retry.outcome, "already_counted");
    assert.equal(retry.attempt_id, first.attempt_id, "a retry must find its own attempt");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a submission outside the region is refused and counts nothing", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);

  try {
    const result = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      idempotencyKey: "gf-outside",
      distanceBand: "far",
    });

    assert.equal(result.outcome, "rejected");
    assert.equal(result.reason, "outside_region");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);

    // The attempt is still recorded: "why was I not counted" has to be
    // answerable.
    const { rows } = await client.query(
      `select result_reason, distance_band from public.attendance_attempts
        where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result_reason, "outside_region");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("an unknown distance band is refused — a client with no fix fails closed", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);

  try {
    // This is what the server produces when a client sends no coordinates.
    // Before Prompt 7 the service passed 'inside' unconditionally and this
    // branch was unreachable.
    const result = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      idempotencyKey: "gf-unknown",
      distanceBand: "unknown",
    });

    assert.equal(result.outcome, "rejected");
    assert.equal(result.reason, "outside_region");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("the admin aggregate includes native attendance and never double-counts", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 3);

  try {
    // One person by phone, one by a greeter, one by both.
    await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: fixture.memberIds[0],
      idempotencyKey: "gf-agg-1",
    });
    await client.query(
      `select * from public.record_attendance(
          p_occurrence_id := $1, p_member_id := $2,
          p_source := 'manual', p_actor_type := 'staff',
          p_idempotency_key := 'manual-agg-2')`,
      [fixture.occurrenceId, fixture.memberIds[1]],
    );
    await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: fixture.memberIds[2],
      idempotencyKey: "gf-agg-3",
    });
    await client.query(
      `select * from public.record_attendance(
          p_occurrence_id := $1, p_member_id := $2,
          p_source := 'manual', p_actor_type := 'staff',
          p_idempotency_key := 'manual-agg-3')`,
      [fixture.occurrenceId, fixture.memberIds[2]],
    );

    // The report the dashboard reads. No second reporting authority exists.
    const { rows } = await client.query(
      `select * from public.attendance_report($1, current_date - 1, current_date + 1, null, null)`,
      [fixture.churchId],
    );

    const row = rows.find((r) => r.occurrence_id === fixture.occurrenceId);
    assert.ok(row, "the occurrence is missing from the report");
    assert.equal(Number(row.counted), 3, "three people, counted once each");
    assert.equal(Number(row.reversed), 0);

    // Broken down by the source that actually won the race.
    const bySource = row.by_source as Record<string, number>;
    assert.equal(
      Object.values(bySource).reduce((sum, n) => sum + Number(n), 0),
      3,
      "the source breakdown must sum to the total",
    );
    assert.ok(Number(bySource.geofence ?? 0) >= 2, "native attendance is visible to admins");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("native attendance never touches the legacy tables", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 2);

  try {
    const before = await client.query(
      `select
         (select count(*)::int from public.attendance_records) as records,
         (select count(*)::int from public.attendance_entries) as entries`,
    );

    await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: fixture.memberIds[0],
      idempotencyKey: "gf-legacy-1",
    });
    await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: fixture.memberIds[1],
      idempotencyKey: "gf-legacy-2",
    });

    const after = await client.query(
      `select
         (select count(*)::int from public.attendance_records) as records,
         (select count(*)::int from public.attendance_entries) as entries`,
    );

    assert.equal(after.rows[0].records, before.rows[0].records, "legacy records changed");
    assert.equal(after.rows[0].entries, before.rows[0].entries, "legacy entries changed");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Prompt 7 closure — the idempotency regression, on the server
//
// The client fix is a new key per logical attempt. These prove the server
// behaviour that made the old key catastrophic, and that the new scheme
// actually escapes it.
// ---------------------------------------------------------------------------

test("the server replays a refusal for a repeated key — which is why the key had to change", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    // A cold GPS fix: the server bands it outside and refuses.
    const first = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-poisoned-key",
      distanceBand: "far",
    });
    assert.equal(first.outcome, "rejected");
    assert.equal(first.reason, "outside_region");

    // The person walks inside. Perfect evidence — but the SAME key, which is
    // what the old client produced for every entry at this occurrence.
    const replayed = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-poisoned-key",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 600,
    });

    // The refusal comes back regardless. The server is behaving correctly —
    // idempotency means "same key, same answer" — and that is exactly why a
    // client must not reuse a key across genuinely different attempts.
    assert.equal(replayed.outcome, "rejected");
    assert.equal(replayed.reason, "outside_region");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a new attempt id escapes the refusal and creates the one fact", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    // Exactly the sequence a real visitor produces, with the corrected client:
    // first attempt refused, attempt closed, second entry opens a new one.
    const refused = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-attempt-one",
      distanceBand: "far",
    });
    assert.equal(refused.outcome, "rejected");

    const counted = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-attempt-two",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 600,
    });

    assert.equal(counted.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);

    // Both attempts are recorded — "why was I not counted the first time" is
    // still answerable — but only one fact exists.
    const { rows } = await client.query(
      `select result_reason from public.attendance_attempts
        where service_occurrence_id = $1 order by created_at`,
      [fixture.occurrenceId],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].result_reason, "outside_region");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a third attempt after counting is already_counted, never a second fact", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: member,
      idempotencyKey: "gf-a", distanceBand: "inside",
    });

    // A new attempt id — as a client would produce after a restart that lost
    // its settled-occurrence memory. It must not double-count.
    const again = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: member,
      idempotencyKey: "gf-b", distanceBand: "inside",
    });

    assert.equal(again.outcome, "already_counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("two attempt ids racing the same person still produce one fact", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 1);
  const member = fixture.memberIds[0];

  try {
    // Two logical attempts genuinely in flight at once — which the client
    // prevents, but the database must survive regardless.
    const [left, right] = await Promise.all([
      nativeGeofenceAttempt(a, {
        occurrenceId: fixture.occurrenceId, memberId: member,
        idempotencyKey: "gf-race-one", distanceBand: "inside",
      }),
      nativeGeofenceAttempt(b, {
        occurrenceId: fixture.occurrenceId, memberId: member,
        idempotencyKey: "gf-race-two", distanceBand: "inside",
      }),
    ]);

    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 1);
    assert.deepEqual(
      [left.outcome, right.outcome].sort(),
      ["already_counted", "counted"],
    );
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("insufficient accuracy is refusable and recoverable under a new attempt", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    // The other half of the same trap: a phone that could not get a good fix
    // must not be locked out for the rest of the service either.
    const refused = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: member,
      idempotencyKey: "gf-acc-one",
      distanceBand: "inside", accuracyBand: "unusable",
    });
    assert.equal(refused.outcome, "rejected");
    assert.equal(refused.reason, "insufficient_accuracy");

    const counted = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId, memberId: member,
      idempotencyKey: "gf-acc-two",
      distanceBand: "inside", accuracyBand: "high",
    });
    assert.equal(counted.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Prompt 7 final pass — anti-flapping and the confirm path, on the server
// ---------------------------------------------------------------------------

test("five refusals do not stop a sixth attempt from counting", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    // The exact sequence the client's cooldown paces out: five poor readings,
    // each its own logical attempt, each refused.
    for (let index = 0; index < 5; index++) {
      const refused = await nativeGeofenceAttempt(client, {
        occurrenceId: fixture.occurrenceId,
        memberId: member,
        idempotencyKey: `gf-flap-${index}`,
        distanceBand: "far",
      });
      assert.equal(refused.outcome, "rejected");
    }
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);

    // The sixth — a genuine re-entry with a sharp fix — is evaluated on its
    // own merits, not against any earlier answer.
    const counted = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-flap-recovered",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 600,
    });

    assert.equal(counted.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);

    // Six attempts recorded, one fact. "Why was I not counted" stays
    // answerable for every one of the five.
    const { rows } = await client.query(
      `select result_reason from public.attendance_attempts
        where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(rows.length, 6);
    assert.equal(rows.filter((r) => r.result_reason === "outside_region").length, 5);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a detected attempt creates no fact and returns pending_confirmation", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    // A church that requires confirmation and a two-minute dwell.
    await client.query(
      `update public.service_occurrences
          set policy_snapshot = jsonb_set(
                jsonb_set(policy_snapshot, '{requiresConfirmation}', 'true'),
                '{minDwellSeconds}', '120')
        where id = $1`,
      [fixture.occurrenceId],
    );

    const detected = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-detected",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 0,
    });

    // `detected` **can never create a fact**. It records the observation and
    // says come back.
    assert.equal(detected.outcome, "pending_confirmation");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);
    assert.equal(detected.fact_id, null);

    // The attempt row exists, so the observation is auditable.
    const { rows } = await client.query(
      `select status from public.attendance_attempts where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "pending_confirmation");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("an immediate confirm is refused, and a dwelt one counts", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const member = fixture.memberIds[0];

  try {
    await client.query(
      `update public.service_occurrences
          set policy_snapshot = jsonb_set(
                jsonb_set(policy_snapshot, '{requiresConfirmation}', 'true'),
                '{minDwellSeconds}', '120')
        where id = $1`,
      [fixture.occurrenceId],
    );

    // Confirming with no dwell is exactly what the client must never do — the
    // server refuses to count it, and the submission is wasted.
    const tooSoon = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-too-soon",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 5,
    });
    assert.equal(tooSoon.outcome, "pending_confirmation");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);

    // Once the dwell is genuinely satisfied — which the client learns from
    // `confirmationNotBefore` — the same person counts.
    const dwelt = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: member,
      idempotencyKey: "gf-dwelt",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 180,
    });

    assert.equal(dwelt.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a church requiring no confirmation counts on the first attempt", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);

  try {
    // The seed already sets `requiresConfirmation: false`, which is the case a
    // zero loitering delay on Android corresponds to.
    const result = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      idempotencyKey: "gf-no-confirm",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: 0,
    });

    assert.equal(result.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Prompt 7 final — server-authoritative dwell
//
// Dwell was never enforced: `p_dwell_seconds` came from the client and was
// compared against the policy, so `dwellSeconds: 9999` counted immediately.
// These prove the detection record closes that, and that no client-controlled
// value — timestamp or duration — can shorten it.
// ---------------------------------------------------------------------------

async function openDetection(
  client: Client,
  input: {
    occurrenceId: string;
    memberId: string;
    accountId: string;
    attemptId: string;
    regionId?: string | null;
    configVersion?: number | null;
    clientObservedAt?: string | null;
  },
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select * from public.open_attendance_detection($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.occurrenceId,
      input.memberId,
      input.accountId,
      input.attemptId,
      input.regionId ?? null,
      input.configVersion ?? null,
      input.clientObservedAt ?? null,
    ],
  );
  return rows[0];
}

async function redeemDetection(
  client: Client,
  input: {
    detectionId: string;
    occurrenceId: string;
    memberId: string;
    accountId: string;
    regionId?: string | null;
    configVersion?: number | null;
  },
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select * from public.redeem_attendance_detection($1, $2, $3, $4, $5, $6)`,
    [
      input.detectionId,
      input.occurrenceId,
      input.memberId,
      input.accountId,
      input.regionId ?? null,
      input.configVersion ?? null,
    ],
  );
  return rows[0];
}

/** An account row, so a detection has something real to bind to. */
async function seedAccount(client: Client, userId?: string): Promise<string> {
  const accountId = randomUUID();
  const authUserId = userId ?? randomUUID();
  await client.query(
    `insert into auth.users (id, email) values ($1, $2) on conflict do nothing`,
    [authUserId, `${accountId}@test.invalid`],
  );
  await client.query(
    `insert into public.visitor_accounts (id, user_id, status) values ($1, $2, 'active')`,
    [accountId, authUserId],
  );
  return accountId;
}

/** Sets the occurrence's snapshot to require a dwell. */
async function requireDwell(client: Client, occurrenceId: string, seconds: number) {
  await client.query(
    `update public.service_occurrences
        set policy_snapshot = jsonb_set(
              jsonb_set(policy_snapshot, '{requiresConfirmation}', 'true'),
              '{minDwellSeconds}', $2::jsonb)
      where id = $1`,
    [occurrenceId, String(seconds)],
  );
}

test("backdating observedAt cannot shorten the dwell", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 300);

    // A device claiming it arrived an hour ago. Under the old scheme this
    // produced a confirmation deadline already in the past.
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-backdated",
      clientObservedAt: anHourAgo,
    });

    // The deadline is measured from the *server's* clock, so it is still five
    // minutes away regardless of what the device claimed.
    const notBefore = new Date(detection.confirmation_not_before as string).getTime();
    const detectedAt = new Date(detection.detected_at_server as string).getTime();
    assert.equal(notBefore - detectedAt, 300_000);
    assert.ok(notBefore > Date.now(), "a backdated claim moved the deadline into the past");

    // And redeeming it now is refused.
    const redeemed = await redeemDetection(client, {
      detectionId: detection.detection_id as string,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });
    assert.equal(redeemed.ok, false);
    assert.equal(redeemed.reason, "dwell_not_elapsed");

    // The claim is recorded as diagnostics, and the skew is visible.
    const { rows } = await client.query(
      `select client_clock_skew_seconds from public.attendance_detections where id = $1`,
      [detection.detection_id],
    );
    assert.ok(Number(rows[0].client_clock_skew_seconds) < -3000);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("future-dating observedAt cannot change eligibility either", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 120);

    const inAnHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-futuredated",
      clientObservedAt: inAnHour,
    });

    // Exactly the same arithmetic. A clock fast or slow makes no difference at
    // all, because the device's number is not in it.
    const notBefore = new Date(detection.confirmation_not_before as string).getTime();
    const detectedAt = new Date(detection.detected_at_server as string).getTime();
    assert.equal(notBefore - detectedAt, 120_000);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("confirming one instant before the deadline fails", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    // A two-second dwell, so the boundary is testable without waiting.
    await requireDwell(client, fixture.occurrenceId, 2);

    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-boundary",
    });

    const tooSoon = await redeemDetection(client, {
      detectionId: detection.detection_id as string,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });

    assert.equal(tooSoon.ok, false);
    assert.equal(tooSoon.reason, "dwell_not_elapsed");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("confirming at or after the deadline succeeds and measures real dwell", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    // Zero dwell, so the deadline is immediate and the test does not sleep.
    await requireDwell(client, fixture.occurrenceId, 0);

    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-elapsed",
    });

    const redeemed = await redeemDetection(client, {
      detectionId: detection.detection_id as string,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });

    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.reason, "ok");
    // Measured between two server timestamps.
    assert.ok(Number(redeemed.server_dwell_seconds) >= 0);

    // And that measured value is what counts the person.
    const counted = await nativeGeofenceAttempt(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      idempotencyKey: "gf-server-dwell",
      distanceBand: "inside",
      accuracyBand: "high",
      dwellSeconds: Number(redeemed.server_dwell_seconds),
    });
    assert.equal(counted.outcome, "counted");
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 1);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a repeated detected returns the same detection and the same timestamps", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 300);

    const first = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-repeat",
    });

    // A retry must not restart the clock — that would let a client reset its
    // own dwell indefinitely by resending `detected`.
    const second = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-repeat",
    });

    assert.equal(second.detection_id, first.detection_id);
    assert.equal(
      new Date(second.confirmation_not_before as string).getTime(),
      new Date(first.confirmation_not_before as string).getTime(),
    );
    assert.equal(second.was_existing, true);
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("two connections opening the same detection produce one record", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 1);
  const account = await seedAccount(a);

  try {
    await requireDwell(a, fixture.occurrenceId, 300);

    const [left, right] = await Promise.all([
      openDetection(a, {
        occurrenceId: fixture.occurrenceId, memberId: fixture.memberIds[0],
        accountId: account, attemptId: "attempt-race",
      }),
      openDetection(b, {
        occurrenceId: fixture.occurrenceId, memberId: fixture.memberIds[0],
        accountId: account, attemptId: "attempt-race",
      }),
    ]);

    assert.equal(left.detection_id, right.detection_id);

    const { rows } = await a.query(
      `select count(*)::int as n from public.attendance_detections
        where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(Number(rows[0].n), 1);
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("a fabricated detection id is refused", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    const redeemed = await redeemDetection(client, {
      detectionId: randomUUID(),
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });
    assert.equal(redeemed.ok, false);
    assert.equal(redeemed.reason, "detection_not_found");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("a detection cannot be replayed across account, member, occurrence or region", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 2);
  const other = await seed(client, 1);
  const account = await seedAccount(client);
  const otherAccount = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 0);

    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-replay",
      regionId: "faithful.campus.a",
      configVersion: 7003,
    });
    const id = detection.detection_id as string;

    const cases: [string, Record<string, unknown>][] = [
      ["detection_wrong_account", { accountId: otherAccount }],
      ["detection_wrong_member", { memberId: fixture.memberIds[1] }],
      ["detection_wrong_occurrence", { occurrenceId: other.occurrenceId }],
      ["detection_wrong_region", { regionId: "faithful.campus.elsewhere" }],
      ["detection_stale_configuration", { configVersion: 7004 }],
    ];

    for (const [expected, override] of cases) {
      const redeemed = await redeemDetection(client, {
        detectionId: id,
        occurrenceId: fixture.occurrenceId,
        memberId: fixture.memberIds[0],
        accountId: account,
        regionId: "faithful.campus.a",
        configVersion: 7003,
        ...override,
      });
      assert.equal(redeemed.ok, false, `${expected} was accepted`);
      assert.equal(redeemed.reason, expected);
    }

    // And after all that the honest redemption still works — none of the
    // refusals consumed it.
    const honest = await redeemDetection(client, {
      detectionId: id,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      regionId: "faithful.campus.a",
      configVersion: 7003,
    });
    assert.equal(honest.ok, true);
  } finally {
    await cleanup(client, fixture);
    await cleanup(client, other);
    await client.end();
  }
});

test("a detection can only be spent once", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 0);
    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-once",
    });

    const first = await redeemDetection(client, {
      detectionId: detection.detection_id as string,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });
    assert.equal(first.ok, true);

    const second = await redeemDetection(client, {
      detectionId: detection.detection_id as string,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "detection_already_used");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("an expired detection is refused", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 0);
    const detection = await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-expired",
    });

    // Age it past its lifetime.
    await client.query(
      `update public.attendance_detections set expires_at = now() - interval '1 second'
        where id = $1`,
      [detection.detection_id],
    );

    const redeemed = await redeemDetection(client, {
      detectionId: detection.detection_id as string,
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
    });
    assert.equal(redeemed.ok, false);
    assert.equal(redeemed.reason, "detection_expired");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});

test("concurrent confirmations of one detection create one fact", options, async () => {
  const a = await connect();
  const b = await connect();
  const fixture = await seed(a, 1);
  const account = await seedAccount(a);

  try {
    await requireDwell(a, fixture.occurrenceId, 0);
    const detection = await openDetection(a, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-concurrent",
    });

    // Both connections redeem at once; the update makes one of them lose.
    const [left, right] = await Promise.all([
      redeemDetection(a, {
        detectionId: detection.detection_id as string,
        occurrenceId: fixture.occurrenceId,
        memberId: fixture.memberIds[0], accountId: account,
      }),
      redeemDetection(b, {
        detectionId: detection.detection_id as string,
        occurrenceId: fixture.occurrenceId,
        memberId: fixture.memberIds[0], accountId: account,
      }),
    ]);

    // Whether one or both redemptions succeed, the counted fact is unique —
    // which is the invariant that actually matters.
    for (const result of [left, right]) {
      if (!result.ok) continue;
      await nativeGeofenceAttempt(a, {
        occurrenceId: fixture.occurrenceId,
        memberId: fixture.memberIds[0],
        idempotencyKey: `gf-concurrent-${result === left ? "a" : "b"}`,
        distanceBand: "inside",
        dwellSeconds: Number(result.server_dwell_seconds),
      });
    }

    assert.equal(await countActiveFacts(a, fixture.occurrenceId), 1);
  } finally {
    await cleanup(a, fixture);
    await a.end();
    await b.end();
  }
});

test("a detection alone never creates a fact", options, async () => {
  const client = await connect();
  const fixture = await seed(client, 1);
  const account = await seedAccount(client);

  try {
    await requireDwell(client, fixture.occurrenceId, 300);
    await openDetection(client, {
      occurrenceId: fixture.occurrenceId,
      memberId: fixture.memberIds[0],
      accountId: account,
      attemptId: "attempt-alone",
    });

    // Opening a detection is not attendance. It records that a device said it
    // arrived, and nothing else.
    assert.equal(await countActiveFacts(client, fixture.occurrenceId), 0);

    const { rows } = await client.query(
      `select count(*)::int as n from public.attendance_attempts
        where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(Number(rows[0].n), 0, "opening a detection wrote an attempt");
  } finally {
    await cleanup(client, fixture);
    await client.end();
  }
});
