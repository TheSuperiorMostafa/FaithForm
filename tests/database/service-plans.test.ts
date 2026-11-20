import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { actAs, connect, one, person, staffUser, suiteOptions, type Client } from "./groups-fixtures";

/**
 * Migration 0175 (Service Plans) against the whole migration chain.
 *
 * Two churches with the feature on, attacked through the browser's own door
 * (the `authenticated` role with a session), plus the integrity rules the
 * service role cannot break either: same-church references, header lengths,
 * one position per slot, share-version bumps, and the atomic commands.
 */

const TABLES = [
  "service_types",
  "service_type_times",
  "teams",
  "team_positions",
  "team_note_categories",
  "songs",
  "song_arrangements",
  "song_attachments",
  "plans",
  "plan_times",
  "plan_items",
  "plan_item_leaders",
  "plan_notes",
  "plan_team_members",
  "plan_shares",
] as const;

type Seeded = {
  church: string;
  admin: string;
  type: string;
  team: string;
  position: string;
  plan: string;
  item: string;
  song: string;
  arrangement: string;
  member: string;
};

async function seedChurch(client: Client, name: string, featureOn = true): Promise<Seeded> {
  const church = randomUUID();
  await client.query(`insert into public.churches (id, name, slug, timezone) values ($1, $2, $3, 'America/New_York')`, [
    church,
    name,
    `sp-${church.slice(0, 8)}`,
  ]);
  if (featureOn) {
    await client.query(
      `insert into public.church_features (church_id, feature_key, enabled) values ($1, 'service_plans', true)`,
      [church],
    );
  }
  const admin = await staffUser(client, church, { role: "admin" });
  const member = await person(client, church, "Mike", name);
  const type = (await one<{ id: string }>(client, `insert into public.service_types (church_id, name) values ($1, 'Sunday Morning') returning id`, [church])).id;
  await client.query(
    `insert into public.service_type_times (church_id, service_type_id, label, weekday, local_time) values ($1, $2, 'Service', 0, '09:00')`,
    [church, type],
  );
  const team = (await one<{ id: string }>(client, `insert into public.teams (church_id, service_type_id, name) values ($1, $2, 'Worship') returning id`, [church, type])).id;
  const position = (await one<{ id: string }>(client, `insert into public.team_positions (church_id, team_id, name) values ($1, $2, 'Keys') returning id`, [church, team])).id;
  await client.query(`insert into public.team_note_categories (church_id, team_id, category) values ($1, $2, 'worship')`, [church, team]);
  const song = (await one<{ id: string }>(client, `insert into public.songs (church_id, title, ccli_number) values ($1, 'Amazing Grace', '22025') returning id`, [church])).id;
  const arrangement = (
    await one<{ id: string }>(client, `insert into public.song_arrangements (church_id, song_id, key) values ($1, $2, 'G') returning id`, [church, song])
  ).id;
  await client.query(
    `insert into public.song_attachments (church_id, arrangement_id, kind, url) values ($1, $2, 'audio_link', 'https://example.test/a.mp3')`,
    [church, arrangement],
  );
  const plan = (
    await one<{ id: string }>(client, `insert into public.plans (church_id, service_type_id, plan_date) values ($1, $2, '2026-11-22') returning id`, [church, type])
  ).id;
  await client.query(`insert into public.plan_times (church_id, plan_id, label, starts_at) values ($1, $2, 'Service', '2026-11-22T14:00:00Z')`, [church, plan]);
  const item = (
    await one<{ id: string }>(
      client,
      `insert into public.plan_items (church_id, plan_id, position, title, length_seconds, song_id, arrangement_id, item_type)
       values ($1, $2, 'a0', 'Amazing Grace', 300, $3, $4, 'song') returning id`,
      [church, plan, song, arrangement],
    )
  ).id;
  await client.query(`insert into public.plan_item_leaders (church_id, plan_id, plan_item_id, person_id) values ($1, $2, $3, $4)`, [church, plan, item, member]);
  await client.query(`insert into public.plan_notes (church_id, plan_id, plan_item_id, category, body) values ($1, $2, $3, 'tech', 'Mic 3')`, [church, plan, item]);
  await client.query(
    `insert into public.plan_team_members (church_id, plan_id, team_position_id, person_id) values ($1, $2, $3, $4)`,
    [church, plan, position, member],
  );
  await client.query(
    `insert into public.plan_shares (church_id, plan_id, send_id, audience, person_id, preset, token_hash, version_sent, expires_at)
     values ($1, $2, gen_random_uuid(), 'person', $3, 'person', sha256(gen_random_uuid()::text::bytea), 1, now() + interval '1 day')`,
    [church, plan, member],
  );
  return { church, admin, type, team, position, plan, item, song, arrangement, member };
}

async function inTx<T>(client: Client, body: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await body();
  } finally {
    await client.query("rollback");
  }
}

async function rejects(client: Client, sql: string, values: unknown[], code?: string): Promise<void> {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, values);
    assert.fail(`expected failure: ${sql}`);
  } catch (error) {
    if ((error as Error).message.startsWith("expected failure")) throw error;
    if (code) assert.equal((error as { code?: string }).code, code, (error as Error).message);
  } finally {
    await client.query("rollback to savepoint attempt");
  }
}

test("service plans: tenant isolation, access switches and integrity", suiteOptions, async (t) => {
  const client = await connect();
  const a = await seedChurch(client, "Alpha");
  const b = await seedChurch(client, "Beta");
  const off = await seedChurch(client, "Gamma", false);
  try {
    await t.test("staff see their own church in every table, and nothing of another's", async () => {
      for (const table of TABLES) {
        const cols = table === "plan_shares" ? "church_id" : "church_id";
        await inTx(client, async () => {
          await actAs(client, a.admin);
          const { rows } = await client.query(`select distinct ${cols} from public.${table}`);
          assert.deepEqual(rows.map((r) => r.church_id), [a.church], `${table}: only church A`);
        });
      }
    });

    await t.test("no browser role can write any table", async () => {
      for (const table of TABLES) {
        await inTx(client, async () => {
          await actAs(client, a.admin);
          await rejects(client, `delete from public.${table} where church_id = $1`, [a.church], "42501");
          await rejects(client, `update public.${table} set church_id = church_id where church_id = $1`, [a.church], "42501");
        });
      }
      await inTx(client, async () => {
        await actAs(client, a.admin);
        await rejects(client, `insert into public.service_types (church_id, name) values ($1, 'X')`, [a.church], "42501");
        await rejects(client, `select public.service_plan_copy_contents($1, $2, $2)`, [a.church, a.plan], "42501");
      });
    });

    await t.test("anonymous visitors read nothing", async () => {
      for (const table of TABLES) {
        await inTx(client, async () => {
          await actAs(client, null);
          await rejects(client, `select 1 from public.${table} limit 1`, [], "42501");
        });
      }
    });

    await t.test("a share's token hash is never readable by staff", async () => {
      await inTx(client, async () => {
        await actAs(client, a.admin);
        await rejects(client, `select token_hash from public.plan_shares`, [], "42501");
        const { rows } = await client.query(`select id, first_viewed_at from public.plan_shares`);
        assert.equal(rows.length, 1);
      });
    });

    await t.test("the feature ships off: a church without the switch sees nothing, admins included", async () => {
      await inTx(client, async () => {
        await actAs(client, off.admin);
        const { rows } = await client.query(`select id from public.plans`);
        assert.equal(rows.length, 0);
      });
    });

    await t.test("a teammate needs the Service Plans grant", async () => {
      const without = await staffUser(client, a.church, { role: "viewer", features: ["people"] });
      const withGrant = await staffUser(client, a.church, { role: "viewer", features: ["service_plans"] });
      await inTx(client, async () => {
        await actAs(client, without);
        assert.equal((await client.query(`select id from public.plans`)).rows.length, 0);
      });
      await inTx(client, async () => {
        await actAs(client, withGrant);
        assert.equal((await client.query(`select id from public.plans`)).rows.length, 1);
      });
    });

    await t.test("rows cannot point across churches, even through the service role", async () => {
      await inTx(client, async () => {
        await rejects(
          client,
          `insert into public.plan_items (church_id, plan_id, position, title) values ($1, $2, 'b0', 'X')`,
          [a.church, b.plan],
          "23503",
        );
        await rejects(
          client,
          `insert into public.plan_item_leaders (church_id, plan_id, plan_item_id, person_id) values ($1, $2, $3, $4)`,
          [a.church, a.plan, a.item, b.member],
          "23514",
        );
        await rejects(
          client,
          `insert into public.plan_item_leaders (church_id, plan_id, plan_item_id, team_position_id) values ($1, $2, $3, $4)`,
          [a.church, a.plan, a.item, b.position],
          "23503",
        );
        await rejects(client, `update public.plan_items set song_id = $2, arrangement_id = null where id = $1`, [a.item, b.song], "23503");
        await rejects(
          client,
          `insert into public.plan_notes (church_id, plan_id, plan_item_id, category, body) values ($1, $2, $3, 'general', 'x')`,
          [a.church, b.plan, a.item],
          "23503",
        );
        await rejects(
          client,
          `insert into public.song_attachments (church_id, arrangement_id, kind, storage_path) values ($1, $2, 'chart_pdf', $3)`,
          [a.church, a.arrangement, `${b.church}/x.pdf`],
          "23514",
        );
      });
    });

    await t.test("plan rules: headers have no length, one item per position, arrangement belongs to the song", async () => {
      await inTx(client, async () => {
        await rejects(
          client,
          `insert into public.plan_items (church_id, plan_id, position, item_type, title, length_seconds) values ($1, $2, 'b0', 'header', 'Worship', 60)`,
          [a.church, a.plan],
          "23514",
        );
        await rejects(
          client,
          `insert into public.plan_items (church_id, plan_id, position, title) values ($1, $2, 'a0', 'Clash')`,
          [a.church, a.plan],
          "23505",
        );
        const other = await one<{ id: string }>(client, `insert into public.songs (church_id, title) values ($1, 'Other') returning id`, [a.church]);
        await rejects(client, `update public.plan_items set song_id = $2 where id = $1`, [a.item, other.id], "23514");
        // A soft-deleted item frees its position for a new one.
        await client.query(`update public.plan_items set deleted_at = now() where id = $1`, [a.item]);
        await client.query(`insert into public.plan_items (church_id, plan_id, position, title) values ($1, $2, 'a0', 'Reuse')`, [a.church, a.plan]);
      });
    });

    await t.test("every visible change bumps the plan's share version", async () => {
      await inTx(client, async () => {
        const v = async () => (await one<{ v: number }>(client, `select share_version v from public.plans where id = $1`, [a.plan])).v;
        const start = await v();
        await client.query(`update public.plan_items set length_seconds = 360 where id = $1`, [a.item]);
        const afterItem = await v();
        assert.ok(afterItem > start);
        await client.query(
          `insert into public.plan_notes (church_id, plan_id, plan_item_id, category, body) values ($1, $2, null, 'general', 'Hello')
           on conflict (plan_id, plan_item_id, category) do update set body = excluded.body`,
          [a.church, a.plan],
        );
        await client.query(
          `insert into public.plan_notes (church_id, plan_id, plan_item_id, category, body) values ($1, $2, null, 'general', 'Hello again')
           on conflict (plan_id, plan_item_id, category) do update set body = excluded.body`,
          [a.church, a.plan],
        );
        const { rows } = await client.query(`select body from public.plan_notes where plan_id = $1 and plan_item_id is null`, [a.plan]);
        assert.deepEqual(rows.map((r) => r.body), ["Hello again"], "one plan-level note per category");
        assert.ok((await v()) > afterItem);
        await client.query(`update public.plans set title = 'Easter' where id = $1`, [a.plan]);
        await client.query(`delete from public.plans where id = $1`, [a.plan]);
      });
    });

    await t.test("copy contents and set leaders are atomic and same-church", async () => {
      await inTx(client, async () => {
        const target = await one<{ id: string }>(
          client,
          `insert into public.plans (church_id, service_type_id, plan_date) values ($1, $2, '2026-11-29') returning id`,
          [a.church, a.type],
        );
        const copied = await one<{ n: number }>(client, `select public.service_plan_copy_contents($1, $2, $3) n`, [a.church, a.plan, target.id]);
        assert.equal(copied.n, 1);
        const counts = await one<{ items: string; leaders: string; notes: string; team: string }>(
          client,
          `select (select count(*) from public.plan_items where plan_id = $1) items,
                  (select count(*) from public.plan_item_leaders where plan_id = $1) leaders,
                  (select count(*) from public.plan_notes where plan_id = $1) notes,
                  (select count(*) from public.plan_team_members where plan_id = $1) team`,
          [target.id],
        );
        assert.deepEqual(counts, { items: "1", leaders: "1", notes: "1", team: "0" });
        await rejects(client, `select public.service_plan_copy_contents($1, $2, $3)`, [a.church, b.plan, target.id], "23514");

        await client.query(`select public.service_plan_set_item_leaders($1, $2, $3::jsonb)`, [
          a.church,
          a.item,
          JSON.stringify([{ teamPositionId: a.position }, { personId: a.member }]),
        ]);
        const { rows } = await client.query(
          `select person_id, team_position_id from public.plan_item_leaders where plan_item_id = $1 order by sort_order`,
          [a.item],
        );
        assert.deepEqual(rows, [
          { person_id: null, team_position_id: a.position },
          { person_id: a.member, team_position_id: null },
        ]);
        await rejects(client, `select public.service_plan_set_item_leaders($1, $2, '[]'::jsonb)`, [b.church, a.item], "P0002");
      });
    });
    await t.test("removing a person or a song cleans up after itself", async () => {
      await inTx(client, async () => {
        await client.query(`delete from public.members where id = $1`, [a.member]);
        await client.query(`delete from public.songs where id = $1`, [a.song]);
        const cleared = await one<{ song_id: string | null; arrangement_id: string | null }>(
          client,
          `select song_id, arrangement_id from public.plan_items where id = $1`,
          [a.item],
        );
        assert.deepEqual(cleared, { song_id: null, arrangement_id: null }, "deleting a song clears it from plans");
        const left = await one<{ n: string }>(client, `select count(*) n from public.plan_shares where church_id = $1`, [a.church]);
        assert.equal(left.n, "0");
      });
    });
  } finally {
    try {
      await client.query("reset role");
      for (const s of [a, b, off]) {
        await client.query(`delete from auth.users where id in (select user_id from public.church_users where church_id = $1)`, [s.church]);
        await client.query(`delete from public.churches where id = $1`, [s.church]);
      }
    } finally {
      await client.end();
    }
  }
});
