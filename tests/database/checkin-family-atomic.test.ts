import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { asUser, one, staffUser, suiteOptions, withChurch, type Client } from "./groups-fixtures";

async function createFamily(
  client: Client,
  churchId: string,
  staffId: string,
  roomId: string,
  phone = "555-010-4343",
) {
  return one<{ result: { householdId: string; children: { memberId: string }[] } }>(client,
    `select public.create_checkin_family(
       $1, $2, 'QA Transaction Family', 'QA Parent', 'Test', $3,
       jsonb_build_array(
         jsonb_build_object('firstName', 'Child One', 'lastName', 'Test',
                            'locationId', $4::text, 'medicalNotes', 'Synthetic note'),
         jsonb_build_object('firstName', 'Child Two', 'lastName', 'Test',
                            'locationId', $4::text)
       )
     ) as result`, [churchId, staffId, phone, roomId]);
}

test("new check-in family saves all People records and links together", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const room = await one<{ id: string }>(client,
      `insert into public.church_locations (church_id, name) values ($1, 'QA Room') returning id`,
      [church.id]);

    await asUser(client, staff, async () => {
      await assert.rejects(createFamily(client, church.id, staff, room.id),
        (error: unknown) => (error as { code?: string }).code === "42501");
    });

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await assert.rejects(createFamily(client, church.id, staff, randomUUID()),
        /Child room is closed or missing/);
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      await client.query(`create function pg_temp.fail_second_family_link() returns trigger language plpgsql as
        'begin if new.relationship = ''dependent'' and
           (select first_name from public.members where id = new.member_id) = ''Child Two''
           then raise exception ''injected family link failure''; end if; return new; end'`);
      await client.query(`create trigger fail_second_family_link before insert on public.household_members
        for each row execute function pg_temp.fail_second_family_link()`);
      await client.query("set local role service_role");
      await assert.rejects(createFamily(client, church.id, staff, room.id),
        /injected family link failure/);
    } finally {
      await client.query("rollback");
    }
    const afterFailure = await one<{ people: string; families: string; links: string }>(client,
      `select (select count(*)::text from public.members where church_id = $1) as people,
              (select count(*)::text from public.households where church_id = $1) as families,
              (select count(*)::text from public.household_members where church_id = $1) as links`,
      [church.id]);
    assert.deepEqual(afterFailure, { people: "0", families: "0", links: "0" });

    let created: { householdId: string; children: { memberId: string }[] };
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      created = (await createFamily(client, church.id, staff, room.id)).result;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    assert.equal(created!.children.length, 2);
    const saved = await one<{ people: string; guardians: string; dependents: string; notes: string }>(client,
      `select (select count(*)::text from public.members where church_id = $1) as people,
              (select count(*)::text from public.household_members
                where household_id = $2 and relationship = 'guardian') as guardians,
              (select count(*)::text from public.household_members
                where household_id = $2 and relationship = 'dependent') as dependents,
              (select count(*)::text from public.members
                where id = any($3::uuid[]) and medical_notes = 'Synthetic note') as notes`,
      [church.id, created!.householdId, created!.children.map((child) => child.memberId)]);
    assert.deepEqual(saved, { people: "3", guardians: "1", dependents: "2", notes: "1" });

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await assert.rejects(createFamily(client, church.id, staff, room.id),
        (error: unknown) => (error as { code?: string }).code === "23505");
    } finally {
      await client.query("rollback");
    }
  });
});
