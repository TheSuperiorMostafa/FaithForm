import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Executable tests for the Prompt 8 check-in functions.
 *
 * Everything here needs a real database, because everything here is a race or a
 * conditional write. Source inspection can show that a partial unique index and
 * an `on conflict do nothing` were written; only two connections hitting them at
 * once shows that one display starts rather than two, that a rotation window
 * converges on one code, and that a single-use pairing code is spent once.
 *
 * They skip loudly with a reason when no disposable target is configured. A skip
 * is not a pass.
 *
 *   FAITHFUL_TEST_DATABASE_URL=postgres://…  pnpm test:database
 */

const DATABASE_URL = process.env.FAITHFUL_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFUL_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "The check-in session races are UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run check-in tests against a production-looking database");
}

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type Fixture = {
  churchId: string;
  campusId: string;
  occurrenceId: string;
  memberIds: string[];
  accountIds: string[];
};

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

/**
 * Runs a test body with connections that are **always** closed.
 *
 * Learned the hard way while writing these. An earlier version cleaned up and
 * then closed inside one `finally`; the first failing assertion made cleanup
 * throw, the close never ran, and an open pg connection kept Node's event loop
 * alive — so the entire run hung silently instead of reporting the failure that
 * caused it. Closing is now separated from cleaning, and cleaning cannot
 * prevent closing.
 */
function run(
  count: number,
  body: (clients: Client[], track: (fixture: Fixture) => void) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const clients: Client[] = [];
    const fixtures: Fixture[] = [];

    try {
      for (let index = 0; index < count; index += 1) clients.push(await connect());
      await body(clients, (fixture) => fixtures.push(fixture));
    } finally {
      for (const fixture of fixtures) {
        try {
          await cleanup(clients[0], fixture);
        } catch {
          // Never let a failed cleanup stop the connections closing.
        }
      }
      for (const client of clients) {
        await client.end().catch(() => {});
      }
    }
  };
}

/**
 * A church, a campus, a live occurrence, members, and visitor accounts.
 *
 * `checkin_closes_at_utc` is three hours out so a session's hard bound is never
 * what decides an outcome — these tests are about the races, not the clock.
 */
async function seed(client: Client, people = 2): Promise<Fixture> {
  const churchId = randomUUID();
  const campusId = randomUUID();
  const occurrenceId = randomUUID();

  await client.query(
    `insert into public.churches (id, name, slug, timezone)
     values ($1, 'Check-in Test Church', $2, 'America/New_York')`,
    [churchId, `checkin-${churchId.slice(0, 8)}`],
  );

  await client.query(
    `insert into public.church_campuses
       (id, church_id, name, slug, latitude, longitude, timezone,
        geofence_radius_m, is_active, is_public, is_primary)
     values ($1, $2, 'Main', 'main', 38.2527, -85.7585, 'America/New_York',
             150, true, true, true)`,
    [campusId, churchId],
  );

  await client.query(
    `insert into public.service_occurrences (
        id, church_id, campus_id, service_time_id, label, local_service_date, timezone,
        starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
        status, generation_source, policy_version, policy_snapshot
     ) values (
        $1, $2, $3, null, 'Check-in Service', current_date, 'America/New_York',
        now() - interval '10 minutes', now() + interval '2 hours',
        now() - interval '1 hour', now() + interval '3 hours',
        'active', 'manual', 1,
        jsonb_build_object(
          'sources', jsonb_build_object('manual', true, 'admin', true,
                                        'geofence', true, 'qr', true, 'kiosk', true),
          'maxLocationAccuracyM', 100, 'minDwellSeconds', 0,
          'requiresConfirmation', false, 'evidenceRetentionDays', 1
        )
     )`,
    [occurrenceId, churchId, campusId],
  );

  const memberIds: string[] = [];
  const accountIds: string[] = [];

  for (let index = 0; index < people; index += 1) {
    const memberId = randomUUID();
    const accountId = randomUUID();
    memberIds.push(memberId);
    accountIds.push(accountId);

    await client.query(
      `insert into public.members (id, church_id, first_name, last_name)
       values ($1, $2, $3, 'Scanner')`,
      [memberId, churchId, `Person${index}`],
    );
    // A visitor account references an auth user, so the auth row has to exist
    // first — the same two-step the concurrency suite uses.
    const authUserId = randomUUID();
    await client.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict do nothing`,
      [authUserId, `${accountId}@test.invalid`],
    );
    await client.query(
      `insert into public.visitor_accounts (id, user_id, status) values ($1, $2, 'active')`,
      [accountId, authUserId],
    );
  }

  return { churchId, campusId, occurrenceId, memberIds, accountIds };
}

async function cleanup(client: Client, fixture: Fixture): Promise<void> {
  await client.query(`delete from public.churches where id = $1`, [fixture.churchId]);
  for (const accountId of fixture.accountIds) {
    await client.query(`delete from public.visitor_accounts where id = $1`, [accountId]);
  }
}

/** A stand-in for the application's keyed hash. The pepper is not in the DB. */
function fakeHash(seed: string): string {
  return Buffer.from(`hash-${seed}-${"0".repeat(40)}`).toString("hex").slice(0, 64);
}

async function startSession(client: Client, fixture: Fixture): Promise<string> {
  const { rows } = await client.query(
    `select * from public.start_attendance_checkin_session($1, $2, null, 30)`,
    [fixture.occurrenceId, fixture.churchId],
  );
  assert.equal(rows[0].ok, true, `could not start a session: ${rows[0].reason}`);
  return rows[0].session_id as string;
}

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

// ---------------------------------------------------------------------------
// One display per service
// ---------------------------------------------------------------------------

test("two pastors starting a display at once produce one session", options,
  run(2, async ([a, b], track) => {
    const fixture = await seed(a);
    track(fixture);

    // Both issued before either is awaited, so they genuinely overlap.
    const [first, second] = await Promise.all([
      a.query(`select * from public.start_attendance_checkin_session($1, $2, null, 30)`,
        [fixture.occurrenceId, fixture.churchId]),
      b.query(`select * from public.start_attendance_checkin_session($1, $2, null, 30)`,
        [fixture.occurrenceId, fixture.churchId]),
    ]);

    assert.equal(first.rows[0].ok, true);
    assert.equal(second.rows[0].ok, true);
    // The same session — otherwise the room would be shown two rotating codes
    // and half the phones would be scanning one the server no longer serves.
    assert.equal(first.rows[0].session_id, second.rows[0].session_id);
    // Exactly one of them created it.
    assert.notEqual(first.rows[0].was_existing, second.rows[0].was_existing);

    const { rows } = await a.query(
      `select count(*)::int as n from public.attendance_checkin_sessions
        where service_occurrence_id = $1 and status = 'active'`,
      [fixture.occurrenceId],
    );
    assert.equal(rows[0].n, 1);
  }));

test("a session cannot be started against another church's service", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);

    const { rows } = await client.query(
      `select * from public.start_attendance_checkin_session($1, $2, null, 30)`,
      [fixture.occurrenceId, randomUUID()],
    );
    assert.equal(rows[0].ok, false);
    // The same answer a non-existent occurrence gets. A caller probing ids
    // learns nothing about which of them are real.
    assert.equal(rows[0].reason, "occurrence_not_found");
  }));

test("a display refuses to start once check-in has closed", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);

    // The whole occurrence moves into the past. `service_occurrences_window_sane`
    // requires ends > starts, closes > opens, and opens <= starts, so moving one
    // column alone is refused by the constraint rather than producing a service
    // that could never have happened.
    await client.query(
      `update public.service_occurrences
          set starts_at_utc = now() - interval '3 hours',
              ends_at_utc = now() - interval '2 hours',
              checkin_opens_at_utc = now() - interval '4 hours',
              checkin_closes_at_utc = now() - interval '2 hours'
        where id = $1`,
      [fixture.occurrenceId],
    );

    const { rows } = await client.query(
      // Zero grace, so "closed two hours ago" really is closed.
      `select * from public.start_attendance_checkin_session($1, $2, null, 30, 0)`,
      [fixture.occurrenceId, fixture.churchId],
    );
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, "too_late");
  }));

test("a cancelled service gets no display", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);

    await client.query(
      `update public.service_occurrences set status = 'cancelled' where id = $1`,
      [fixture.occurrenceId],
    );

    const { rows } = await client.query(
      `select * from public.start_attendance_checkin_session($1, $2, null, 30)`,
      [fixture.occurrenceId, fixture.churchId],
    );
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, "occurrence_cancelled");
  }));

test("the rotation period is clamped rather than trusted", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);

    // A one-second rotation would be unscannable; an hour would not be a
    // rotating code at all. Both are clamped instead of accepted or refused.
    const fast = await client.query(
      `select * from public.start_attendance_checkin_session($1, $2, null, 1)`,
      [fixture.occurrenceId, fixture.churchId],
    );
    assert.equal(fast.rows[0].rotation_seconds, 15);

    await client.query(
      `select public.end_attendance_checkin_session($1, $2, null)`,
      [fast.rows[0].session_id, fixture.churchId],
    );

    const slow = await client.query(
      `select * from public.start_attendance_checkin_session($1, $2, null, 100000)`,
      [fixture.occurrenceId, fixture.churchId],
    );
    assert.equal(slow.rows[0].rotation_seconds, 120);
  }));

test("stopping a display frees the occurrence for a new one", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    // Another church's id ends nothing.
    const foreign = await client.query(
      `select public.end_attendance_checkin_session($1, $2, null) as ok`,
      [sessionId, randomUUID()],
    );
    assert.equal(foreign.rows[0].ok, false);

    const ended = await client.query(
      `select public.end_attendance_checkin_session($1, $2, null) as ok`,
      [sessionId, fixture.churchId],
    );
    assert.equal(ended.rows[0].ok, true);

    // Ending twice is not an error, but it is not a second end either.
    const again = await client.query(
      `select public.end_attendance_checkin_session($1, $2, null) as ok`,
      [sessionId, fixture.churchId],
    );
    assert.equal(again.rows[0].ok, false);

    // The partial index let go, so a new display can start.
    const restarted = await client.query(
      `select * from public.start_attendance_checkin_session($1, $2, null, 30)`,
      [fixture.occurrenceId, fixture.churchId],
    );
    assert.equal(restarted.rows[0].ok, true);
    assert.notEqual(restarted.rows[0].session_id, sessionId);
  }));

// ---------------------------------------------------------------------------
// Rotation windows converge
// ---------------------------------------------------------------------------

test("two pollers in one window claim one code", options,
  run(2, async ([a, b], track) => {
    const fixture = await seed(a);
    track(fixture);
    const sessionId = await startSession(a, fixture);

    // Two browser tabs, two different candidate sets, same window.
    const [first, second] = await Promise.all([
      a.query(
        `select * from public.claim_attendance_checkin_code(
           $1, 900, $2, 'nonce-a', now(), now() + interval '60 seconds')`,
        [sessionId, [fakeHash("a0"), fakeHash("a1")]],
      ),
      b.query(
        `select * from public.claim_attendance_checkin_code(
           $1, 900, $2, 'nonce-b', now(), now() + interval '60 seconds')`,
        [sessionId, [fakeHash("b0"), fakeHash("b1")]],
      ),
    ]);

    assert.equal(first.rows[0].ok, true);
    assert.equal(second.rows[0].ok, true);
    // **The convergence property.** Both tabs must show the same code, or the
    // room sees one code while the server accepts a different one.
    assert.equal(first.rows[0].code_id, second.rows[0].code_id);
    assert.equal(first.rows[0].nonce, second.rows[0].nonce);
    assert.notEqual(first.rows[0].was_existing, second.rows[0].was_existing);

    const { rows } = await a.query(
      `select count(*)::int as n from public.attendance_checkin_codes
        where session_id = $1 and window_index = 900`,
      [sessionId],
    );
    assert.equal(rows[0].n, 1);
  }));

test("a later window mints a new code, so the display actually rotates", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const first = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 1000, $2, 'nonce-1000', now(), now() + interval '60 seconds')`,
      [sessionId, [fakeHash("w1000")]],
    );
    const second = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 1001, $2, 'nonce-1001', now(), now() + interval '60 seconds')`,
      [sessionId, [fakeHash("w1001")]],
    );

    assert.notEqual(first.rows[0].code_id, second.rows[0].code_id);
    assert.notEqual(first.rows[0].nonce, second.rows[0].nonce);
  }));

test("a re-poll in the same window returns the same code, not a new one", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const first = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 1100, $2, 'nonce-first', now(), now() + interval '60 seconds')`,
      [sessionId, [fakeHash("repoll")]],
    );
    // A projector reloading mid-window. If this minted a fresh code the room
    // would be stranded scanning the one still in their eyes.
    const second = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 1100, $2, 'nonce-second', now(), now() + interval '60 seconds')`,
      [sessionId, [fakeHash("repoll-different")]],
    );

    assert.equal(second.rows[0].was_existing, true);
    assert.equal(second.rows[0].code_id, first.rows[0].code_id);
    assert.equal(second.rows[0].nonce, "nonce-first");
  }));

test("a collision with a live code falls through to the next candidate", options,
  run(1, async ([client], track) => {
    const one = await seed(client);
    const two = await seed(client);
    track(one);
    track(two);

    const sessionA = await startSession(client, one);
    const sessionB = await startSession(client, two);
    const collides = fakeHash("the-same-derived-code");

    await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 2000, $2, 'nonce-a', now(), now() + interval '60 seconds')`,
      [sessionA, [collides]],
    );

    // A different church derives the identical code. A typed code must resolve
    // to exactly one session, so the second offers its next candidate.
    const second = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 2000, $2, 'nonce-b', now(), now() + interval '60 seconds')`,
      [sessionB, [collides, fakeHash("the-fallback-code")]],
    );

    assert.equal(second.rows[0].ok, true);
    assert.equal(second.rows[0].derivation_attempt, 1);
  }));

test("no code is shown at all rather than one belonging elsewhere", options,
  run(1, async ([client], track) => {
    const one = await seed(client);
    const two = await seed(client);
    track(one);
    track(two);

    const sessionA = await startSession(client, one);
    const sessionB = await startSession(client, two);
    const taken = fakeHash("every-candidate-collides");

    await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 3000, $2, 'nonce-a', now(), now() + interval '60 seconds')`,
      [sessionA, [taken]],
    );

    // Every candidate collides. Failing closed is the point: showing the code
    // anyway would check people into another church's service.
    const second = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 3000, $2, 'nonce-b', now(), now() + interval '60 seconds')`,
      [sessionB, [taken]],
    );
    assert.equal(second.rows[0].ok, false);
    assert.equal(second.rows[0].code_id, null);
  }));

test("a stopped session claims no further codes", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    await client.query(
      `select public.end_attendance_checkin_session($1, $2, null)`,
      [sessionId, fixture.churchId],
    );

    const { rows } = await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 4000, $2, 'nonce', now(), now() + interval '60 seconds')`,
      [sessionId, [fakeHash("after-the-stop")]],
    );
    assert.equal(rows[0].ok, false);
  }));

// ---------------------------------------------------------------------------
// Short-code redemption
// ---------------------------------------------------------------------------

test("a typed code resolves inside its window and not outside it", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const hash = fakeHash("typed-code");
    await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 5000, $2, 'nonce-typed',
         now() - interval '10 seconds', now() + interval '50 seconds')`,
      [sessionId, [hash]],
    );

    const live = await client.query(
      `select * from public.redeem_attendance_short_code($1)`,
      [hash],
    );
    assert.equal(live.rows[0].ok, true);
    assert.equal(live.rows[0].service_occurrence_id, fixture.occurrenceId);
    assert.equal(live.rows[0].nonce, "nonce-typed");

    // Before the window opens and after it closes, both refused.
    const early = await client.query(
      `select * from public.redeem_attendance_short_code($1, now() - interval '1 minute')`,
      [hash],
    );
    assert.equal(early.rows[0].ok, false);

    const late = await client.query(
      `select * from public.redeem_attendance_short_code($1, now() + interval '5 minutes')`,
      [hash],
    );
    assert.equal(late.rows[0].ok, false);
  }));

test("a typed code is NOT consumed — the whole room may use it", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const hash = fakeHash("shared-code");
    await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 6000, $2, 'nonce-shared', now(), now() + interval '60 seconds')`,
      [sessionId, [hash]],
    );

    // **The behaviour Prompt 6 got wrong.** Four people looking at one screen
    // is the normal case, not an attack.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { rows } = await client.query(
        `select * from public.redeem_attendance_short_code($1)`,
        [hash],
      );
      assert.equal(rows[0].ok, true, `redemption ${attempt} was refused`);
    }
  }));

test("stopping the display kills a code still inside its window", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const hash = fakeHash("revoked-code");
    await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 7000, $2, 'nonce-revoked', now(), now() + interval '10 minutes')`,
      [sessionId, [hash]],
    );

    assert.equal(
      (await client.query(`select * from public.redeem_attendance_short_code($1)`, [hash]))
        .rows[0].ok,
      true,
    );

    await client.query(
      `select public.end_attendance_checkin_session($1, $2, null)`,
      [sessionId, fixture.churchId],
    );

    // **This is what a signature alone can never do.** The code is still well
    // inside its window; the session is what revokes it.
    const after = await client.query(
      `select * from public.redeem_attendance_short_code($1)`,
      [hash],
    );
    assert.equal(after.rows[0].ok, false);
    assert.equal(after.rows[0].reason, "session_ended");
  }));

test("an unknown code is refused without a hint", options,
  run(1, async ([client]) => {
    for (const bad of [fakeHash("never-existed"), "", "short"]) {
      const { rows } = await client.query(
        `select * from public.redeem_attendance_short_code($1)`,
        [bad],
      );
      assert.equal(rows[0].ok, false);
      // Nothing about which church, which service, or whether it ever existed.
      assert.equal(rows[0].session_id, null);
      assert.equal(rows[0].service_occurrence_id, null);
      assert.equal(rows[0].church_id, null);
      assert.equal(rows[0].nonce, null);
    }
  }));

// ---------------------------------------------------------------------------
// Per-account scan redemption
// ---------------------------------------------------------------------------

test("many accounts may redeem one nonce; one account records it once", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client, 3);
    track(fixture);

    // Three different people scanning the code on the wall.
    for (const accountId of fixture.accountIds) {
      const { rows } = await client.query(
        `select public.record_attendance_qr_scan($1, $2, $3, 'shared-nonce', 'qr') as first_time`,
        [fixture.occurrenceId, accountId, fixture.churchId],
      );
      assert.equal(rows[0].first_time, true);
    }

    // The same person scanning it again is not new — and is not an error.
    const repeat = await client.query(
      `select public.record_attendance_qr_scan($1, $2, $3, 'shared-nonce', 'qr') as first_time`,
      [fixture.occurrenceId, fixture.accountIds[0], fixture.churchId],
    );
    assert.equal(repeat.rows[0].first_time, false);

    const { rows } = await client.query(
      `select count(*)::int as n from public.attendance_qr_scan_redemptions
        where service_occurrence_id = $1 and nonce = 'shared-nonce'`,
      [fixture.occurrenceId],
    );
    assert.equal(rows[0].n, 3);
  }));

test("two connections recording the same scan create one row", options,
  run(2, async ([a, b], track) => {
    const fixture = await seed(a, 1);
    track(fixture);

    await Promise.all([
      a.query(
        `select public.record_attendance_qr_scan($1, $2, $3, 'raced-nonce', 'qr')`,
        [fixture.occurrenceId, fixture.accountIds[0], fixture.churchId],
      ),
      b.query(
        `select public.record_attendance_qr_scan($1, $2, $3, 'raced-nonce', 'short_code')`,
        [fixture.occurrenceId, fixture.accountIds[0], fixture.churchId],
      ),
    ]);

    const { rows } = await a.query(
      `select count(*)::int as n from public.attendance_qr_scan_redemptions
        where service_occurrence_id = $1 and account_id = $2 and nonce = 'raced-nonce'`,
      [fixture.occurrenceId, fixture.accountIds[0]],
    );
    assert.equal(rows[0].n, 1);
  }));

test("a scan redemption creates no attendance fact on its own", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client, 1);
    track(fixture);

    await client.query(
      `select public.record_attendance_qr_scan($1, $2, $3, 'audit-only', 'qr')`,
      [fixture.occurrenceId, fixture.accountIds[0], fixture.churchId],
    );

    // The row is an audit trail, not a check-in. Only `record_attendance` may
    // create a counted fact, and nothing here calls it.
    const { rows } = await client.query(
      `select count(*)::int as n from public.attendance_facts
        where service_occurrence_id = $1`,
      [fixture.occurrenceId],
    );
    assert.equal(rows[0].n, 0);
  }));

// ---------------------------------------------------------------------------
// Display pairing
// ---------------------------------------------------------------------------

test("a pairing code is spent exactly once, even under a race", options,
  run(2, async ([a, b], track) => {
    const fixture = await seed(a);
    track(fixture);
    const sessionId = await startSession(a, fixture);

    const hash = fakeHash("pairing-code");
    await a.query(
      `insert into public.attendance_display_pairings
         (session_id, church_id, code_hash, expires_at)
       values ($1, $2, $3, now() + interval '5 minutes')`,
      [sessionId, fixture.churchId, hash],
    );

    // Two machines typing the same code at the same moment.
    const [first, second] = await Promise.all([
      a.query(`select * from public.redeem_attendance_display_pairing($1)`, [hash]),
      b.query(`select * from public.redeem_attendance_display_pairing($1)`, [hash]),
    ]);

    const wins = [first, second].filter((result) => result.rows[0].ok === true);
    assert.equal(wins.length, 1, "a single-use pairing code was spent twice");
    assert.equal(wins[0].rows[0].service_occurrence_id, fixture.occurrenceId);

    // And a third attempt afterwards gets nothing.
    const third = await a.query(
      `select * from public.redeem_attendance_display_pairing($1)`,
      [hash],
    );
    assert.equal(third.rows[0].ok, false);
  }));

test("an expired pairing code and an unknown one read identically", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const expiredHash = fakeHash("expired-pairing");
    await client.query(
      `insert into public.attendance_display_pairings
         (session_id, church_id, code_hash, expires_at)
       values ($1, $2, $3, now() - interval '1 minute')`,
      [sessionId, fixture.churchId, expiredHash],
    );

    const expired = await client.query(
      `select * from public.redeem_attendance_display_pairing($1)`,
      [expiredHash],
    );
    const unknown = await client.query(
      `select * from public.redeem_attendance_display_pairing($1)`,
      [fakeHash("no-such-pairing")],
    );

    assert.equal(expired.rows[0].ok, false);
    assert.equal(unknown.rows[0].ok, false);
    // **Indistinguishable.** A machine typing codes must not learn which of its
    // guesses corresponded to something real.
    assert.equal(expired.rows[0].reason, unknown.rows[0].reason);
  }));

test("a pairing for a stopped display buys nothing", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    const hash = fakeHash("orphaned-pairing");
    await client.query(
      `insert into public.attendance_display_pairings
         (session_id, church_id, code_hash, expires_at)
       values ($1, $2, $3, now() + interval '5 minutes')`,
      [sessionId, fixture.churchId, hash],
    );
    await client.query(
      `select public.end_attendance_checkin_session($1, $2, null)`,
      [sessionId, fixture.churchId],
    );

    const { rows } = await client.query(
      `select * from public.redeem_attendance_display_pairing($1)`,
      [hash],
    );
    assert.equal(rows[0].ok, false);
  }));

// ---------------------------------------------------------------------------
// Kiosk sessions
// ---------------------------------------------------------------------------

async function seedKiosk(
  client: Client,
  fixture: Fixture,
  idleLockSeconds = 300,
): Promise<{ kioskId: string; pairingHash: string }> {
  const kioskId = randomUUID();
  const pairingHash = fakeHash(`kiosk-pairing-${kioskId}`);

  await client.query(
    `insert into public.attendance_kiosk_sessions
       (id, church_id, service_occurrence_id, campus_id, label, status,
        pairing_code_hash, pairing_expires_at, idle_lock_seconds, expires_at)
     values ($1, $2, $3, $4, 'Welcome desk', 'pending',
             $5, now() + interval '5 minutes', $6, now() + interval '3 hours')`,
    [kioskId, fixture.churchId, fixture.occurrenceId, fixture.campusId,
     pairingHash, idleLockSeconds],
  );

  return { kioskId, pairingHash };
}

test("a kiosk pairs once and the code cannot be reused", options,
  run(2, async ([a, b], track) => {
    const fixture = await seed(a);
    track(fixture);
    const { pairingHash } = await seedKiosk(a, fixture);

    const [first, second] = await Promise.all([
      a.query(`select * from public.pair_attendance_kiosk($1, $2)`,
        [pairingHash, fakeHash("credential-a")]),
      b.query(`select * from public.pair_attendance_kiosk($1, $2)`,
        [pairingHash, fakeHash("credential-b")]),
    ]);

    const wins = [first, second].filter((result) => result.rows[0].ok === true);
    assert.equal(wins.length, 1, "one pairing code produced two credentials");
    assert.equal(wins[0].rows[0].service_occurrence_id, fixture.occurrenceId);

    // The pairing hash is cleared on success, so it cannot be presented again.
    const third = await a.query(
      `select * from public.pair_attendance_kiosk($1, $2)`,
      [pairingHash, fakeHash("credential-c")],
    );
    assert.equal(third.rows[0].ok, false);
  }));

test("a kiosk credential resolves to one occurrence and nothing wider", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const { pairingHash } = await seedKiosk(client, fixture);

    const credentialHash = fakeHash("resolving-credential");
    await client.query(`select * from public.pair_attendance_kiosk($1, $2)`,
      [pairingHash, credentialHash]);

    const { rows } = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [credentialHash],
    );

    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].service_occurrence_id, fixture.occurrenceId);
    assert.equal(rows[0].church_id, fixture.churchId);
    // Nothing that names a person, a role, or a user.
    const columns = Object.keys(rows[0]);
    for (const forbidden of ["user_id", "role", "started_by", "credential_hash"]) {
      assert.ok(!columns.includes(forbidden), `a resolved kiosk exposes ${forbidden}`);
    }
  }));

test("a kiosk locks itself after sitting idle, and unlocks on use", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    // A two-minute idle window, then backdate `last_used_at` past it.
    const { pairingHash } = await seedKiosk(client, fixture, 120);

    const credentialHash = fakeHash("idle-credential");
    await client.query(`select * from public.pair_attendance_kiosk($1, $2)`,
      [pairingHash, credentialHash]);

    // Still fresh.
    assert.equal(
      (await client.query(`select * from public.resolve_attendance_kiosk_session($1)`,
        [credentialHash])).rows[0].ok,
      true,
    );

    await client.query(
      `update public.attendance_kiosk_sessions
          set last_used_at = now() - interval '10 minutes'
        where credential_hash = $1`,
      [credentialHash],
    );

    const locked = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [credentialHash],
    );
    assert.equal(locked.rows[0].ok, false);
    assert.equal(locked.rows[0].reason, "idle_locked");
    // A locked kiosk reveals no occurrence and no church.
    assert.equal(locked.rows[0].service_occurrence_id, null);
    assert.equal(locked.rows[0].church_id, null);

    // **And a lock is not a revocation.** Touching it brings it back, which is
    // what makes the timeout usable rather than a trip to the dashboard.
    await client.query(
      `update public.attendance_kiosk_sessions set last_used_at = now()
        where credential_hash = $1`,
      [credentialHash],
    );
    assert.equal(
      (await client.query(`select * from public.resolve_attendance_kiosk_session($1)`,
        [credentialHash])).rows[0].ok,
      true,
    );
  }));

test("a polling kiosk does not keep resetting a lock it should have tripped", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const { pairingHash } = await seedKiosk(client, fixture, 60);

    const credentialHash = fakeHash("polling-credential");
    await client.query(`select * from public.pair_attendance_kiosk($1, $2)`,
      [pairingHash, credentialHash]);

    await client.query(
      `update public.attendance_kiosk_sessions
          set last_used_at = now() - interval '5 minutes'
        where credential_hash = $1`,
      [credentialHash],
    );

    // The idle check and the `last_used_at` touch are one statement. If they
    // were two, this call would refresh the clock on its way to failing and the
    // next call would succeed — a lock that never trips.
    const first = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [credentialHash],
    );
    const second = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [credentialHash],
    );

    assert.equal(first.rows[0].ok, false);
    assert.equal(second.rows[0].ok, false, "the lock reset itself on a failed resolve");
  }));

test("an expired kiosk is refused, and an unknown credential says nothing", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const { pairingHash } = await seedKiosk(client, fixture);

    const credentialHash = fakeHash("expiring-credential");
    await client.query(`select * from public.pair_attendance_kiosk($1, $2)`,
      [pairingHash, credentialHash]);

    await client.query(
      `update public.attendance_kiosk_sessions
          set expires_at = now() - interval '1 minute'
        where credential_hash = $1`,
      [credentialHash],
    );

    const expired = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [credentialHash],
    );
    assert.equal(expired.rows[0].ok, false);
    assert.equal(expired.rows[0].reason, "ended");

    const unknown = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [fakeHash("never-issued")],
    );
    assert.equal(unknown.rows[0].ok, false);
    assert.equal(unknown.rows[0].reason, "unknown");
  }));

test("revoking a kiosk stops its credential immediately", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const { kioskId, pairingHash } = await seedKiosk(client, fixture);

    const credentialHash = fakeHash("revoked-credential");
    await client.query(`select * from public.pair_attendance_kiosk($1, $2)`,
      [pairingHash, credentialHash]);

    // What `endKioskSession` does: null the hash so nothing can match it.
    await client.query(
      `update public.attendance_kiosk_sessions
          set status = 'ended', credential_hash = null, ended_at = now()
        where id = $1 and church_id = $2`,
      [kioskId, fixture.churchId],
    );

    const { rows } = await client.query(
      `select * from public.resolve_attendance_kiosk_session($1)`,
      [credentialHash],
    );
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].reason, "unknown");
  }));

// ---------------------------------------------------------------------------
// A kiosk check-in goes through the one attendance command
// ---------------------------------------------------------------------------

test("a kiosk check-in produces exactly one fact, and a retry finds it", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client, 1);
    track(fixture);
    const member = fixture.memberIds[0];
    const key = `kiosk-${randomUUID()}`;

    const first = await client.query(
      `select * from public.record_attendance($1, $2, 'kiosk', 'kiosk', $3)`,
      [fixture.occurrenceId, member, key],
    );
    assert.equal(first.rows[0].outcome, "counted");

    // The same tap retried after a dropped response. `record_attendance` replays
    // a counted attempt as `already_counted` — which the client treats as the
    // success it is, and which says truthfully that the fact already existed
    // before this call rather than that this call created it.
    const retry = await client.query(
      `select * from public.record_attendance($1, $2, 'kiosk', 'kiosk', $3)`,
      [fixture.occurrenceId, member, key],
    );
    assert.equal(retry.rows[0].outcome, "already_counted");
    assert.equal(retry.rows[0].fact_id, first.rows[0].fact_id);

    // A different tap for the same person is already counted, not a second fact.
    const again = await client.query(
      `select * from public.record_attendance($1, $2, 'kiosk', 'kiosk', $3)`,
      [fixture.occurrenceId, member, `kiosk-${randomUUID()}`],
    );
    assert.equal(again.rows[0].outcome, "already_counted");

    const { rows } = await client.query(
      `select count(*)::int as n from public.attendance_facts
        where service_occurrence_id = $1 and status = 'active'`,
      [fixture.occurrenceId],
    );
    assert.equal(rows[0].n, 1);
  }));

test("a QR check-in and a kiosk check-in for one person are one fact", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client, 1);
    track(fixture);
    const member = fixture.memberIds[0];

    // **The rule that makes multi-use codes safe.** Someone scans the projector
    // and a volunteer also taps their name at the desk. Two sources, two
    // audited attempts, one counted person.
    const scanned = await client.query(
      `select * from public.record_attendance($1, $2, 'qr', 'visitor', $3, $4)`,
      [fixture.occurrenceId, member, `qr-${randomUUID()}`, fixture.accountIds[0]],
    );
    assert.equal(scanned.rows[0].outcome, "counted");

    const desk = await client.query(
      `select * from public.record_attendance($1, $2, 'kiosk', 'kiosk', $3)`,
      [fixture.occurrenceId, member, `kiosk-${randomUUID()}`],
    );
    assert.equal(desk.rows[0].outcome, "already_counted");

    const { rows } = await client.query(
      `select count(*)::int as n from public.attendance_facts
        where service_occurrence_id = $1 and status = 'active'`,
      [fixture.occurrenceId],
    );
    assert.equal(rows[0].n, 1);
  }));

// ---------------------------------------------------------------------------
// The purge
// ---------------------------------------------------------------------------

test("expired capabilities are removed and sessions are ended, not deleted", options,
  run(1, async ([client], track) => {
    const fixture = await seed(client);
    track(fixture);
    const sessionId = await startSession(client, fixture);

    await client.query(
      `select * from public.claim_attendance_checkin_code(
         $1, 8000, $2, 'nonce-old',
         now() - interval '3 hours', now() - interval '2 hours')`,
      [sessionId, [fakeHash("stale-code")]],
    );
    await client.query(
      `insert into public.attendance_display_pairings
         (session_id, church_id, code_hash, expires_at)
       values ($1, $2, $3, now() - interval '2 hours')`,
      [sessionId, fixture.churchId, fakeHash("stale-pairing")],
    );
    await client.query(
      `update public.attendance_checkin_sessions
          set expires_at = now() - interval '1 minute' where id = $1`,
      [sessionId],
    );

    const { rows } = await client.query(
      `select * from public.purge_attendance_checkin_artifacts()`,
    );
    assert.ok(Number(rows[0].codes_removed) >= 1);
    assert.ok(Number(rows[0].pairings_removed) >= 1);
    assert.ok(Number(rows[0].sessions_ended) >= 1);

    // The session survives as history; only its capability is gone.
    const session = await client.query(
      `select status from public.attendance_checkin_sessions where id = $1`,
      [sessionId],
    );
    assert.equal(session.rows.length, 1);
    assert.equal(session.rows[0].status, "ended");
  }));
