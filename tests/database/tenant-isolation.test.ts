import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { actAs, connect, refused, staffUser, suiteOptions, type Client } from "./groups-fixtures";

/**
 * Two churches, built on the migration chain that ships, attacked through the
 * one door every signed-in person holds: PostgREST with their own session.
 *
 * Church A's admin tries every plausible path to church B's rows — read,
 * update, delete, insert-with-B's-id, and moving a row of A's into B — across
 * the tables that hold people, money, calls, children and media. Then the
 * write paths this audit closed: recording rows (0107), slide versions for
 * another church's sermon (0108), and an app account's security columns
 * (0108).
 */

type World = {
  a: string;
  b: string;
  adminA: string;
  adminB: string;
  appUser: string;
  ids: Record<string, string>;
};

async function seed(client: Client): Promise<World> {
  const a = randomUUID();
  const b = randomUUID();
  const adminA = randomUUID();
  const adminB = randomUUID();
  const appUser = randomUUID();
  await client.query(
    `insert into auth.users (id, email) values ($1, $4), ($2, $5), ($3, $6)`,
    [adminA, adminB, appUser, `a-${adminA}@x.test`, `b-${adminB}@x.test`, `app-${appUser}@x.test`],
  );
  await client.query(
    `insert into public.churches (id, name, slug) values ($1, 'Church A', $3), ($2, 'Church B', $4)`,
    [a, b, `iso-a-${a.slice(0, 8)}`, `iso-b-${b.slice(0, 8)}`],
  );
  await client.query(
    `insert into public.church_users (church_id, user_id, role) values ($1, $2, 'admin'), ($3, $4, 'admin')`,
    [a, adminA, b, adminB],
  );

  const ids: Record<string, string> = {};
  const row = async (key: string, sql: string, values: unknown[]) => {
    ids[key] = (await client.query(sql, values)).rows[0].id as string;
  };
  for (const [church, suffix] of [[a, "A"], [b, "B"]] as const) {
    await row(`member${suffix}`, `insert into public.members (church_id, first_name, last_name, medical_notes) values ($1, 'Kid', $2, 'peanut allergy') returning id`, [church, suffix]);
    await row(`donor${suffix}`, `insert into public.giving_donors (church_id, email, name) values ($1, $2, 'Donor') returning id`, [church, `d-${suffix}-${church}@x.test`]);
    await row(`donation${suffix}`, `insert into public.giving_donations (church_id, amount_cents, status, donor_email) values ($1, 5000, 'succeeded', 'd@x.test') returning id`, [church]);
    await row(`call${suffix}`, `insert into public.phone_calls (church_id, caller_number, transcript) values ($1, '+15550000000', 'private') returning id`, [church]);
    await row(`household${suffix}`, `insert into public.households (church_id, name) values ($1, 'Family') returning id`, [church]);
    await row(`announcement${suffix}`, `insert into public.announcements (church_id, event_title, title) values ($1, 'Picnic', 'Picnic') returning id`, [church]);
    await row(`recording${suffix}`, `insert into public.stream_recordings (church_id, storage_path, status) values ($1, $2, 'ready') returning id`, [church, `relay/${church}/stream_x-1700000000.mp4`]);
    await row(`sermon${suffix}`, `insert into public.sermons (church_id, created_by, title) values ($1, $2, 'Grace') returning id`, [church, suffix === "A" ? adminA : adminB]);
  }
  await client.query(`insert into public.visitor_accounts (user_id) values ($1)`, [appUser]);
  return { a, b, adminA, adminB, appUser, ids };
}

const TABLES: [table: string, key: string][] = [
  ["members", "member"],
  ["giving_donors", "donor"],
  ["giving_donations", "donation"],
  ["phone_calls", "call"],
  ["households", "household"],
  ["announcements", "announcement"],
  ["stream_recordings", "recording"],
  ["sermons", "sermon"],
];

async function inTransaction(client: Client, body: () => Promise<void>) {
  await client.query("begin");
  try {
    await body();
  } finally {
    await client.query("rollback");
  }
}

test("a staff session reads only its granted financial, call, and family areas", suiteOptions, async () => {
  const client = await connect();
  try {
    await inTransaction(client, async () => {
      const w = await seed(client);
      const fileId = randomUUID();
      await client.query(
        `insert into public.member_files
           (id, church_id, member_id, storage_path, label, file_name, mime_type, size_bytes, visibility)
         values ($1, $2, $3, $4, 'Consent', 'consent.pdf', 'application/pdf', 12, 'staff')`,
        [fileId, w.a, w.ids.memberA, `${w.a}/${w.ids.memberA}/${fileId}.pdf`],
      );
      const noGrants = await staffUser(client, w.a, { role: "viewer" });
      const giving = await staffUser(client, w.a, { role: "viewer", features: ["giving"] });
      const calls = await staffUser(client, w.a, { role: "viewer", features: ["voice_assistant"] });
      const people = await staffUser(client, w.a, { role: "viewer", features: ["people"] });
      const attendance = await staffUser(client, w.a, { role: "viewer", features: ["attendance"] });

      const read = async (userId: string, table: string): Promise<string[]> => {
        await client.query("savepoint staff_read");
        try {
          await actAs(client, userId);
          const result = await client.query(`select id from public.${table} order by id`);
          return result.rows.map((row) => row.id as string);
        } finally {
          await client.query("rollback to savepoint staff_read");
          await client.query("release savepoint staff_read");
        }
      };

      for (const table of ["members", "member_files", "giving_donors", "giving_donations", "phone_calls", "households"]) {
        assert.deepEqual(await read(noGrants, table), [], `${table}: ungranted staff read a row`);
      }
      assert.deepEqual(await read(giving, "giving_donations"), [w.ids.donationA]);
      assert.deepEqual(await read(giving, "giving_donors"), [w.ids.donorA]);
      assert.deepEqual(await read(giving, "phone_calls"), []);
      assert.deepEqual(await read(calls, "phone_calls"), [w.ids.callA]);
      assert.deepEqual(await read(calls, "giving_donations"), []);
      assert.deepEqual(await read(people, "members"), [w.ids.memberA]);
      assert.deepEqual(await read(people, "member_files"), [fileId]);
      assert.deepEqual(await read(people, "households"), [w.ids.householdA]);
      assert.deepEqual(await read(attendance, "members"), [w.ids.memberA]);
      assert.deepEqual(await read(attendance, "households"), []);

      // Column grants keep the roster available without giving any browser
      // session the medical note. Authorized pages read it on the server.
      for (const userId of [attendance, people]) {
        await client.query("savepoint medical_read");
        try {
          await actAs(client, userId);
          assert.ok(
            await refused(client, "select medical_notes from public.members where id = $1", [w.ids.memberA]),
            "staff fetched a medical note directly",
          );
        } finally {
          await client.query("rollback to savepoint medical_read");
          await client.query("release savepoint medical_read");
        }
      }

      await client.query("savepoint server_medical_read");
      try {
        await client.query("set local role service_role");
        const medical = await client.query("select medical_notes from public.members where id = $1", [w.ids.memberA]);
        assert.equal(medical.rows[0]?.medical_notes, "peanut allergy");
      } finally {
        await client.query("rollback to savepoint server_medical_read");
        await client.query("release savepoint server_medical_read");
      }

      // A church switch must also cut off an otherwise valid feature grant.
      await client.query(
        `insert into public.church_features (church_id, feature_key, enabled)
         values ($1, 'giving', false)`,
        [w.a],
      );
      assert.deepEqual(await read(giving, "giving_donations"), []);
    });
  } finally {
    await client.end();
  }
});

test("church A's admin cannot read, change, delete, or plant rows in church B", suiteOptions, async () => {
  const client = await connect();
  try {
    await inTransaction(client, async () => {
      const w = await seed(client);
      await actAs(client, w.adminA);

      for (const [table, key] of TABLES) {
        const theirs = w.ids[`${key}B`];
        const mine = w.ids[`${key}A`];

        const read = await client.query(`select id from public.${table} where id = $1`, [theirs]);
        assert.equal(read.rowCount, 0, `${table}: read church B's row`);
        const all = await client.query(`select distinct church_id from public.${table}`);
        assert.ok(all.rows.every((r) => r.church_id === w.a), `${table}: a list leaked another church`);

        assert.ok(
          await refused(client, `update public.${table} set church_id = church_id where id = $1`, [theirs]),
          `${table}: updated church B's row`,
        );
        assert.ok(await refused(client, `delete from public.${table} where id = $1`, [theirs]), `${table}: deleted church B's row`);
        assert.ok(
          await refused(client, `update public.${table} set church_id = $2 where id = $1`, [mine, w.b]),
          `${table}: moved a row into church B`,
        );
      }

      assert.ok(
        await refused(client, `insert into public.members (church_id, first_name, last_name) values ($1, 'x', 'y')`, [w.b]),
        "planted a person in church B",
      );
      assert.ok(
        await refused(client, `insert into public.announcements (church_id, event_title) values ($1, 'x')`, [w.b]),
        "planted an announcement in church B",
      );
    });
  } finally {
    await client.end();
  }
});

test("signed-out callers read nothing private", suiteOptions, async () => {
  const client = await connect();
  try {
    await inTransaction(client, async () => {
      const w = await seed(client);
      await actAs(client, null);
      for (const [table, key] of TABLES) {
        const denied = await refused(client, `select id from public.${table} where id = $1`, [w.ids[`${key}B`]]);
        assert.ok(denied, `anon read ${table}`);
      }
    });
  } finally {
    await client.end();
  }
});

test("recording rows are written by the server only (0107)", suiteOptions, async () => {
  const client = await connect();
  try {
    await inTransaction(client, async () => {
      const w = await seed(client);
      await actAs(client, w.adminA);
      // Pointing A's own row at B's file was the attack.
      assert.ok(
        await refused(client, `update public.stream_recordings set storage_path = $2 where id = $1`, [
          w.ids.recordingA,
          `relay/${w.b}/stream_x-1700000000.mp4`,
        ]),
        "an admin re-pointed a recording's storage path",
      );
      assert.ok(
        await refused(client, `insert into public.stream_recordings (church_id, storage_path) values ($1, 'relay/x/y.mp4')`, [w.a]),
      );
      assert.ok(await refused(client, `delete from public.stream_recordings where id = $1`, [w.ids.recordingA]));
      const own = await client.query(`select id from public.stream_recordings where id = $1`, [w.ids.recordingA]);
      assert.equal(own.rowCount, 1, "staff still read their own recordings");
    });
  } finally {
    await client.end();
  }
});

test("slides cannot be published against another church's sermon (0108)", suiteOptions, async () => {
  const client = await connect();
  try {
    await inTransaction(client, async () => {
      const w = await seed(client);
      await actAs(client, w.adminA);
      assert.ok(
        await refused(
          client,
          `insert into public.sermon_presentation_versions (sermon_id, church_id, version, content_hash, manifest)
           values ($1, $2, 1, 'h', '{}')`,
          [w.ids.sermonB, w.a],
        ),
        "planted a slide version on church B's sermon",
      );
    });
  } finally {
    await client.end();
  }
});

test("an app user cannot rewrite their own account's security columns (0108)", suiteOptions, async () => {
  const client = await connect();
  try {
    await inTransaction(client, async () => {
      const w = await seed(client);
      await actAs(client, w.appUser);
      assert.ok(
        await refused(client, `update public.visitor_accounts set authorization_version = 1, status = 'active' where user_id = $1`, [
          w.appUser,
        ]),
      );
      const own = await client.query(`select id from public.visitor_accounts where user_id = $1`, [w.appUser]);
      assert.equal(own.rowCount, 1, "their own row is still readable");
    });
  } finally {
    await client.end();
  }
});
