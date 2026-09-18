import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Migration 0083 against real Postgres.
 *
 * Two promises, each of which had no working path before:
 *
 *   - **Joining a church makes you one of its people.** Whichever door leads to
 *     `joined`, the account ends up linked to a People record — a new one made
 *     from its name, or, when someone by that name is already there, a claim a
 *     person decides. Automatic check-in needs exactly that link.
 *
 *   - **A check-in is attendance.** The weekly sheet, the app, a scanned code,
 *     the kiosk, the Services roster and a room check-in are read as one list,
 *     and each person counts once a day however many ways they were recorded.
 *
 *   FAITHFORM_TEST_DATABASE_URL=postgres://…  pnpm test:concurrency
 *
 * Each test builds its own church under a fresh uuid and deletes it afterwards.
 */

const DATABASE_URL = process.env.FAITHFORM_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFORM_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "Migration 0083's People connection and attendance totals are UNOBSERVED until this runs.";

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

/** Runs a body with a connection that is always closed, and a church that is always removed. */
async function withChurch(
  body: (client: Client, churchId: string) => Promise<void>,
): Promise<void> {
  const client = await connect();
  const churchId = randomUUID();
  try {
    await client.query(
      `insert into public.churches (id, name, slug) values ($1, 'People Test', $2)`,
      [churchId, `people-${churchId.slice(0, 8)}`],
    );
    await body(client, churchId);
  } finally {
    try {
      await client.query(
        `delete from auth.users where id in (
           select a.user_id from public.visitor_accounts a
            where a.id in (
              select account_id from public.visitor_church_relationships where church_id = $1
            )
         )`,
        [churchId],
      );
      // A room with history refuses deletion (0071), so its sessions go first.
      await client.query(`delete from public.checkin_sessions where church_id = $1`, [churchId]);
      await client.query(`delete from public.churches where id = $1`, [churchId]);
    } finally {
      await client.end();
    }
  }
}

async function appAccount(
  client: Client,
  input: { displayName?: string | null; signUpName?: Record<string, string>; status?: string } = {},
): Promise<string> {
  const { rows: users } = await client.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [`${randomUUID()}@example.com`, JSON.stringify(input.signUpName ?? {})],
  );
  const { rows } = await client.query(
    `insert into public.visitor_accounts (user_id, display_name, status)
     values ($1, $2, $3) returning id`,
    [users[0].id, input.displayName ?? null, input.status ?? "active"],
  );
  return rows[0].id as string;
}

async function setState(client: Client, accountId: string, churchId: string, state: string) {
  await client.query(
    `insert into public.visitor_church_relationships (account_id, church_id, state)
     values ($1, $2, $3)
     on conflict (account_id, church_id) do update set state = excluded.state`,
    [accountId, churchId, state],
  );
}

async function person(
  client: Client,
  churchId: string,
  first: string,
  last: string,
  source = "dashboard",
): Promise<string> {
  const { rows } = await client.query(
    `insert into public.members (church_id, first_name, last_name, source)
     values ($1, $2, $3, $4) returning id`,
    [churchId, first, last, source],
  );
  return rows[0].id as string;
}

async function people(client: Client, churchId: string) {
  const { rows } = await client.query(
    `select id, first_name, last_name, email, source, is_active
       from public.members where church_id = $1 order by created_at, id`,
    [churchId],
  );
  return rows;
}

async function activeLink(client: Client, accountId: string, churchId: string) {
  const { rows } = await client.query(
    `select id, member_id, claim_id, linked_by from public.visitor_people_links
      where account_id = $1 and church_id = $2 and is_active`,
    [accountId, churchId],
  );
  return rows[0] ?? null;
}

async function openClaims(client: Client, churchId: string) {
  const { rows } = await client.query(
    `select id, account_id, source, claimed_first_name, claimed_last_name, requested_member_id
       from public.visitor_people_claims
      where church_id = $1 and status in ('pending', 'disputed')`,
    [churchId],
  );
  return rows;
}

async function connectMember(client: Client, accountId: string, churchId: string, actor?: string) {
  const { rows } = await client.query(
    `select public.connect_app_member($1, $2, $3) as outcome`,
    [accountId, churchId, actor ?? null],
  );
  return rows[0].outcome as string;
}

async function version(client: Client, accountId: string): Promise<number> {
  const { rows } = await client.query(
    `select authorization_version from public.visitor_accounts where id = $1`,
    [accountId],
  );
  return Number(rows[0].authorization_version);
}

async function occurrence(client: Client, churchId: string, date: string): Promise<string> {
  const { rows } = await client.query(
    `insert into public.service_occurrences
       (church_id, label, local_service_date, timezone, starts_at_utc, ends_at_utc,
        checkin_opens_at_utc, checkin_closes_at_utc, generation_source)
     values ($1, 'Worship', $2::date, 'America/New_York',
             ($2::date + time '15:00') at time zone 'UTC',
             ($2::date + time '16:30') at time zone 'UTC',
             ($2::date + time '14:00') at time zone 'UTC',
             ($2::date + time '17:00') at time zone 'UTC',
             'manual')
     returning id`,
    [churchId, date],
  );
  return rows[0].id as string;
}

async function fact(
  client: Client,
  churchId: string,
  occurrenceId: string,
  memberId: string,
  source: string,
  status = "active",
): Promise<string> {
  const { rows } = await client.query(
    `insert into public.attendance_facts (church_id, service_occurrence_id, member_id, source, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [churchId, occurrenceId, memberId, source, status],
  );
  return rows[0].id as string;
}

async function sheet(
  client: Client,
  churchId: string,
  date: string,
  entries: { memberId: string | null; status: "present" | "absent" }[],
  totals?: { present: number; absent: number },
): Promise<string> {
  const present = totals?.present ?? entries.filter((e) => e.status === "present").length;
  const absent = totals?.absent ?? entries.filter((e) => e.status === "absent").length;
  const { rows } = await client.query(
    `insert into public.attendance_records (church_id, service_date, total_present, total_absent)
     values ($1, $2::date, $3, $4) returning id`,
    [churchId, date, present, absent],
  );
  const recordId = rows[0].id as string;
  for (const entry of entries) {
    await client.query(
      `insert into public.attendance_entries (record_id, church_id, member_id, status)
       values ($1, $2, $3, $4)`,
      [recordId, churchId, entry.memberId, entry.status],
    );
  }
  return recordId;
}

async function room(
  client: Client,
  churchId: string,
  memberId: string,
  date: string,
  status: "pre_checked_in" | "checked_in" | "checked_out" | "cancelled",
): Promise<string> {
  const { rows: locations } = await client.query(
    `insert into public.church_locations (church_id, name) values ($1, $2) returning id`,
    [churchId, `Room ${randomUUID().slice(0, 4)}`],
  );
  const { rows } = await client.query(
    `insert into public.checkin_sessions
       (church_id, member_id, location_id, local_service_date, status, checked_in_at, checked_out_at)
     values ($1, $2, $3, $4::date, $5,
             case when $5 in ('checked_in', 'checked_out') then now() end,
             case when $5 = 'checked_out' then now() end)
     returning id`,
    [churchId, memberId, locations[0].id, date, status],
  );
  return rows[0].id as string;
}

// ---------------------------------------------------------------------------
// Joining makes you one of the church's people
// ---------------------------------------------------------------------------

test("joining creates a People record from the name alone, and links it", options, async () => {
  await withChurch(async (client, churchId) => {
    const accountId = await appAccount(client, { displayName: "  Ann   Lee " });
    const before = await version(client, accountId);

    await setState(client, accountId, churchId, "joined");

    const rows = await people(client, churchId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, "Ann");
    assert.equal(rows[0].last_name, "Lee");
    assert.equal(rows[0].source, "app");
    // The church is told it sees a member's name. Not their sign-in email.
    assert.equal(rows[0].email, null);

    const link = await activeLink(client, accountId, churchId);
    assert.ok(link, "the account is linked");
    assert.equal(link.member_id, rows[0].id);
    assert.equal(link.linked_by, null, "no staff member chose this");

    // A device holding a cached "no link" refusal must ask again.
    assert.equal(await version(client, accountId), before + 1);

    const { rows: events } = await client.query(
      `select action, actor_type from public.visitor_people_link_events where account_id = $1`,
      [accountId],
    );
    assert.deepEqual(events, [{ action: "member_created_on_join", actor_type: "system" }]);
  });
});

test("following or asking to join connects nothing; approval does", options, async () => {
  await withChurch(async (client, churchId) => {
    const accountId = await appAccount(client, { displayName: "Ruth Moab" });

    await setState(client, accountId, churchId, "following");
    await setState(client, accountId, churchId, "pending");
    assert.equal((await people(client, churchId)).length, 0);
    assert.equal(await activeLink(client, accountId, churchId), null);

    await setState(client, accountId, churchId, "joined");
    assert.equal((await people(client, churchId)).length, 1);
    assert.ok(await activeLink(client, accountId, churchId));
  });
});

test("someone already in People by that name is a question for staff, not a guess", options, async () => {
  await withChurch(async (client, churchId) => {
    // Split differently across the columns, and in another case: still the
    // same name.
    const existing = await person(client, churchId, "mary", "ann smith");
    const accountId = await appAccount(client, { displayName: "Mary Ann Smith" });

    await setState(client, accountId, churchId, "joined");

    const rows = await people(client, churchId);
    assert.deepEqual(rows.map((row) => row.id), [existing], "no second Mary Ann Smith");
    assert.equal(await activeLink(client, accountId, churchId), null, "never linked to her by name");

    const claims = await openClaims(client, churchId);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].source, "join");
    assert.equal(claims[0].claimed_first_name, "Mary Ann");
    assert.equal(claims[0].claimed_last_name, "Smith");
    assert.equal(claims[0].requested_member_id, null, "a suggestion is never stored as an answer");

    // Asking again changes nothing while the question is open.
    assert.equal(await connectMember(client, accountId, churchId), "awaiting_staff");
    assert.equal((await openClaims(client, churchId)).length, 1);
  });
});

test("an account with no name at all waits for staff", options, async () => {
  await withChurch(async (client, churchId) => {
    const accountId = await appAccount(client, { displayName: null });
    await setState(client, accountId, churchId, "joined");

    assert.equal((await people(client, churchId)).length, 0);
    const claims = await openClaims(client, churchId);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimed_first_name, null);
  });
});

test("the name typed at sign-up stands in for a missing display name", options, async () => {
  await withChurch(async (client, churchId) => {
    // Dashboard staff opening the app carry their name as `full_name`.
    const accountId = await appAccount(client, {
      displayName: "   ",
      signUpName: { full_name: "Pastor Dan Rivera" },
    });
    await setState(client, accountId, churchId, "joined");

    const rows = await people(client, churchId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].first_name, "Pastor Dan");
    assert.equal(rows[0].last_name, "Rivera");
  });
});

test("leaving and joining again does not make a second person", options, async () => {
  await withChurch(async (client, churchId) => {
    const accountId = await appAccount(client, { displayName: "Lydia Thyatira" });
    await setState(client, accountId, churchId, "joined");
    await setState(client, accountId, churchId, "left");
    await setState(client, accountId, churchId, "joined");

    assert.equal((await people(client, churchId)).length, 1);
    assert.equal(await connectMember(client, accountId, churchId), "already_linked");
  });
});

test("an inactive account, or one that has not joined, is left alone", options, async () => {
  await withChurch(async (client, churchId) => {
    const leaving = await appAccount(client, { displayName: "Demas Gone", status: "deletion_requested" });
    await setState(client, leaving, churchId, "joined");
    assert.equal(await connectMember(client, leaving, churchId), "account_inactive");

    const visitor = await appAccount(client, { displayName: "Nico Demus" });
    await setState(client, visitor, churchId, "following");
    assert.equal(await connectMember(client, visitor, churchId), "not_joined");

    assert.equal((await people(client, churchId)).length, 0);
  });
});

test("two devices connecting at once make one person", options, async () => {
  await withChurch(async (client, churchId) => {
    // Joined while deactivated, so the trigger declines and both sessions
    // below race the real decision.
    const accountId = await appAccount(client, { displayName: "Eunice Timothy", status: "deactivated" });
    await setState(client, accountId, churchId, "joined");
    await client.query(`update public.visitor_accounts set status = 'active' where id = $1`, [accountId]);

    const first = await connect();
    const second = await connect();
    try {
      await first.query("begin");
      await second.query("begin");
      assert.equal(await connectMember(first, accountId, churchId), "linked");

      const racing = connectMember(second, accountId, churchId);
      // The second decision waits on the first rather than making its own.
      await new Promise((resolve) => setTimeout(resolve, 150));
      await first.query("commit");
      assert.equal(await racing, "already_linked");
      await second.query("commit");
    } finally {
      await first.end();
      await second.end();
    }

    assert.equal((await people(client, churchId)).length, 1);
  });
});

test("joining never fails because People could not be updated", options, async () => {
  await withChurch(async (client, churchId) => {
    const accountId = await appAccount(client, { displayName: "Silas Philippi" });
    await client.query("begin");
    try {
      // Make creating the record impossible for the length of this transaction.
      await client.query(
        `alter table public.members add constraint members_refuse_app_for_test check (source <> 'app') not valid`,
      );
      await setState(client, accountId, churchId, "joined");

      const { rows } = await client.query(
        `select state from public.visitor_church_relationships where account_id = $1 and church_id = $2`,
        [accountId, churchId],
      );
      assert.equal(rows[0].state, "joined", "still joined");
      assert.equal(await activeLink(client, accountId, churchId), null);
      assert.equal((await people(client, churchId)).length, 0, "and nothing half-made");
    } finally {
      await client.query("rollback");
    }
  });
});

// ---------------------------------------------------------------------------
// Staff answers
// ---------------------------------------------------------------------------

test("staff can answer a claim with someone new", options, async () => {
  await withChurch(async (client, churchId) => {
    await person(client, churchId, "John", "Mark");
    const accountId = await appAccount(client, { displayName: "John Mark" });
    await setState(client, accountId, churchId, "joined");
    const [claim] = await openClaims(client, churchId);

    const { rows: staff } = await client.query(`insert into auth.users (email) values (null) returning id`);
    const staffId = staff[0].id as string;
    try {
      const { rows } = await client.query(
        `select public.add_people_claim_as_new_person($1, $2, $3, $4, $5) as member_id`,
        [churchId, claim.id, staffId, " Johnny ", "Mark"],
      );
      const memberId = rows[0].member_id as string;

      const created = (await people(client, churchId)).find((row) => row.id === memberId);
      assert.equal(created?.first_name, "Johnny");
      assert.equal(created?.source, "app");

      const link = await activeLink(client, accountId, churchId);
      assert.equal(link?.member_id, memberId);
      assert.equal(link?.claim_id, claim.id);
      assert.equal(link?.linked_by, staffId);

      const { rows: resolved } = await client.query(
        `select status, resolved_member_id from public.visitor_people_claims where id = $1`,
        [claim.id],
      );
      assert.deepEqual(resolved[0], { status: "approved", resolved_member_id: memberId });

      // Answered is answered: a replay cannot make a second person.
      await assert.rejects(
        client.query(`select public.add_people_claim_as_new_person($1, $2, $3, 'Again', '')`, [
          churchId,
          claim.id,
          staffId,
        ]),
        /claim_resolved/,
      );
      // And a claim from another church matches nothing.
      await assert.rejects(
        client.query(`select public.add_people_claim_as_new_person($1, $2, $3, 'X', '')`, [
          randomUUID(),
          claim.id,
          staffId,
        ]),
        /claim_not_found/,
      );
    } finally {
      await client.query(`delete from auth.users where id = $1`, [staffId]);
    }
  });
});

test("moving an app connection carries what the app record gathered, and retires it", options, async () => {
  await withChurch(async (client, churchId) => {
    // Joined as "Bob Smith"; the church has him as "Robert Smith".
    const accountId = await appAccount(client, { displayName: "Bob Smith" });
    await setState(client, accountId, churchId, "joined");
    const appRecord = (await activeLink(client, accountId, churchId)).member_id as string;
    const robert = await person(client, churchId, "Robert", "Smith");

    const sundayOne = await occurrence(client, churchId, "2026-09-06");
    const sundayTwo = await occurrence(client, churchId, "2026-09-13");
    const onlyApp = await fact(client, churchId, sundayOne, appRecord, "geofence");
    const duplicate = await fact(client, churchId, sundayTwo, appRecord, "geofence");
    await fact(client, churchId, sundayTwo, robert, "manual");

    // One sheet with both of them on it: the app record present, Robert absent.
    const shared = await sheet(client, churchId, "2026-09-13", [
      { memberId: appRecord, status: "present" },
      { memberId: robert, status: "absent" },
    ]);
    // One sheet with only the app record.
    const alone = await sheet(client, churchId, "2026-09-06", [{ memberId: appRecord, status: "present" }]);
    const roomVisit = await room(client, churchId, appRecord, "2026-09-06", "checked_out");

    const { rows: staff } = await client.query(`insert into auth.users (email) values (null) returning id`);
    const staffId = staff[0].id as string;
    try {
      await client.query(`select public.move_people_link($1, $2, $3, $4)`, [
        churchId,
        appRecord,
        robert,
        staffId,
      ]);

      assert.equal((await activeLink(client, accountId, churchId))?.member_id, robert, "the link moved");

      const { rows: facts } = await client.query(
        `select id, member_id, status from public.attendance_facts where id = any($1::uuid[])`,
        [[onlyApp, duplicate]],
      );
      const byId = new Map(facts.map((row) => [row.id, row]));
      assert.equal(byId.get(onlyApp)?.member_id, robert, "a service only the app saw is now Robert's");
      assert.equal(byId.get(duplicate)?.status, "reversed", "a service already counted is not counted twice");

      const { rows: corrections } = await client.query(
        `select action, fact_id from public.attendance_corrections where fact_id = $1`,
        [duplicate],
      );
      assert.deepEqual(corrections, [{ action: "reverse", fact_id: duplicate }]);

      const { rows: sharedEntries } = await client.query(
        `select member_id, status from public.attendance_entries where record_id = $1`,
        [shared],
      );
      assert.deepEqual(sharedEntries, [{ member_id: robert, status: "present" }], "present wins, once");
      const { rows: sharedTotals } = await client.query(
        `select total_present, total_absent from public.attendance_records where id = $1`,
        [shared],
      );
      assert.deepEqual(sharedTotals[0], { total_present: 1, total_absent: 0 });

      const { rows: aloneEntries } = await client.query(
        `select member_id from public.attendance_entries where record_id = $1`,
        [alone],
      );
      assert.deepEqual(aloneEntries, [{ member_id: robert }]);

      const { rows: sessions } = await client.query(
        `select member_id from public.checkin_sessions where id = $1`,
        [roomVisit],
      );
      assert.equal(sessions[0].member_id, robert);

      const retired = (await people(client, churchId)).find((row) => row.id === appRecord);
      assert.equal(retired?.is_active, false, "the app record is retired, not deleted");
    } finally {
      await client.query(`delete from auth.users where id = $1`, [staffId]);
    }
  });
});

test("moving a connection off a record the church made moves only the link", options, async () => {
  await withChurch(async (client, churchId) => {
    const accountId = await appAccount(client, { displayName: "Priscilla Aquila" });
    const churchRecord = await person(client, churchId, "Priscilla", "Aquila");
    const other = await person(client, churchId, "Prisca", "Aquila");
    await setState(client, accountId, churchId, "joined");
    // Same name, so staff linked it by hand the old way.
    await client.query(
      `update public.visitor_people_claims set status = 'approved' where account_id = $1`,
      [accountId],
    );
    await client.query(
      `insert into public.visitor_people_links (account_id, church_id, member_id) values ($1, $2, $3)`,
      [accountId, churchId, churchRecord],
    );
    const occ = await occurrence(client, churchId, "2026-09-13");
    const history = await fact(client, churchId, occ, churchRecord, "manual");

    await client.query(`select public.move_people_link($1, $2, $3, null)`, [churchId, churchRecord, other]);

    assert.equal((await activeLink(client, accountId, churchId))?.member_id, other);
    const { rows } = await client.query(`select member_id, status from public.attendance_facts where id = $1`, [
      history,
    ]);
    assert.deepEqual(rows[0], { member_id: churchRecord, status: "active" }, "history stays put");
    assert.equal((await people(client, churchId)).find((row) => row.id === churchRecord)?.is_active, true);

    // A person someone else is already linked to cannot be taken.
    const second = await appAccount(client, { displayName: "Someone Else" });
    await setState(client, second, churchId, "joined");
    const secondRecord = (await activeLink(client, second, churchId)).member_id as string;
    await assert.rejects(
      client.query(`select public.move_people_link($1, $2, $3, null)`, [churchId, secondRecord, other]),
      /member_already_claimed/,
    );
  });
});

// ---------------------------------------------------------------------------
// One answer to "who came"
// ---------------------------------------------------------------------------

test("each person counts once a day, however many ways they were recorded", options, async () => {
  await withChurch(async (client, churchId) => {
    const ann = await person(client, churchId, "Ann", "Lee");
    const ben = await person(client, churchId, "Ben", "Ray");
    const cal = await person(client, churchId, "Cal", "Vin");
    const deleted = await person(client, churchId, "Dee", "Gone");

    const sunday = "2026-09-13";
    const occ = await occurrence(client, churchId, sunday);

    // Ann: on the sheet, in the app, and in a room. One person.
    await sheet(client, churchId, sunday, [
      { memberId: ann, status: "present" },
      { memberId: ben, status: "absent" },
      { memberId: cal, status: "absent" },
      { memberId: deleted, status: "present" },
    ]);
    await fact(client, churchId, occ, ann, "geofence");
    await room(client, churchId, ann, sunday, "checked_in");
    // Ben: absent on the sheet, but scanned the code. Present.
    await fact(client, churchId, occ, ben, "qr");
    // Cal: only said he was coming, and a reversed count. Neither is presence.
    await room(client, churchId, cal, sunday, "pre_checked_in");
    await fact(client, churchId, occ, cal, "kiosk", "reversed");
    // Someone deleted after the sheet was saved still counted that day.
    await client.query(`delete from public.members where id = $1`, [deleted]);

    // A sheet saved with a total and no entries is a floor, not a zero.
    await sheet(client, churchId, "2026-09-06", [], { present: 7, absent: 0 });

    const { rows } = await client.query(
      `select service_date::text, present, absent, checked_in, automatic, has_sheet
         from public.attendance_presence_by_date($1, '2026-09-01', '2026-09-30')`,
      [churchId],
    );
    // Ben was marked absent but scanned in, so only Cal is absent.
    assert.deepEqual(rows, [
      { service_date: "2026-09-06", present: 7, absent: 0, checked_in: 0, automatic: 0, has_sheet: true },
      { service_date: "2026-09-13", present: 3, absent: 1, checked_in: 2, automatic: 1, has_sheet: true },
    ]);

    const { rows: methods } = await client.query(
      `select member_id, method from public.attendance_presence($1, $2::date, $2::date)
        where member_id = $3 order by method`,
      [churchId, sunday, ann],
    );
    assert.deepEqual(
      methods.map((row) => row.method),
      ["automatic", "room", "weekly"],
    );
  });
});

test("check-ins before any sheet still count, and legacy copies are not read twice", options, async () => {
  await withChurch(async (client, churchId) => {
    const ann = await person(client, churchId, "Ann", "Lee");
    const occ = await occurrence(client, churchId, "2026-09-20");
    await fact(client, churchId, occ, ann, "legacy");
    const earlier = await occurrence(client, churchId, "2026-09-13");
    await fact(client, churchId, earlier, ann, "geofence");
    await sheet(client, churchId, "2026-08-30", [{ memberId: ann, status: "present" }]);

    const { rows } = await client.query(
      `select service_date::text, present, checked_in, has_sheet
         from public.attendance_presence_by_date($1, '2026-08-01', '2026-09-30')`,
      [churchId],
    );
    assert.deepEqual(rows, [
      { service_date: "2026-08-30", present: 1, checked_in: 0, has_sheet: true },
      { service_date: "2026-09-13", present: 1, checked_in: 1, has_sheet: false },
    ]);

    const { rows: totals } = await client.query(
      `select member_id, days_present, last_present::text from public.attendance_presence_by_member($1)`,
      [churchId],
    );
    assert.deepEqual(totals, [{ member_id: ann, days_present: 2, last_present: "2026-09-13" }]);
  });
});
