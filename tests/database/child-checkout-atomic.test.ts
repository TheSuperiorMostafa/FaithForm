import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { asUser, one, person, staffUser, suiteOptions, withChurch, type Client } from "./groups-fixtures";

async function release(
  client: Client,
  input: { church: string; sessions: string[]; household: string; guardian: string; staff: string },
  sessionIds = input.sessions,
) {
  return one<{ released: number }>(client,
    `select public.release_checkin_sessions($1, $2::uuid[], $3, 'code', $4, null, $5) as released`,
    [input.church, sessionIds, input.household, input.guardian, input.staff]);
}

test("child pickup releases every selected session or none", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const guardian = await person(client, church.id, "Pat", "Parent");
    const childA = await person(client, church.id, "Sam", "Child");
    const childB = await person(client, church.id, "Jo", "Child");
    const household = await one<{ id: string }>(client,
      `insert into public.households (church_id, name) values ($1, 'Test family') returning id`,
      [church.id]);
    const room = await one<{ id: string }>(client,
      `insert into public.church_locations (church_id, name) values ($1, 'Nursery') returning id`,
      [church.id]);
    for (const [member, relationship] of [
      [guardian, "guardian"], [childA, "dependent"], [childB, "dependent"],
    ]) {
      await client.query(
        `insert into public.household_members (church_id, household_id, member_id, relationship)
         values ($1, $2, $3, $4)`,
        [church.id, household.id, member, relationship]);
    }
    const sessions: string[] = [];
    for (const member of [childA, childB]) {
      const session = await one<{ id: string }>(client,
        `insert into public.checkin_sessions
           (church_id, member_id, household_id, location_id, local_service_date, status)
         values ($1, $2, $3, $4, current_date, 'checked_in') returning id`,
        [church.id, member, household.id, room.id]);
      sessions.push(session.id);
    }
    const input = { church: church.id, sessions, household: household.id, guardian, staff };
    const outsider = await person(client, church.id, "Unlisted", "Adult");
    const adultSession = await one<{ id: string }>(client,
      `insert into public.checkin_sessions
         (church_id, member_id, household_id, location_id, local_service_date, status)
       values ($1, $2, $3, $4, current_date, 'checked_in') returning id`,
      [church.id, guardian, household.id, room.id]);

    await asUser(client, staff, async () => {
      await assert.rejects(release(client, input),
        (error: unknown) => (error as { code?: string }).code === "42501");
    });

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await assert.rejects(release(client, input, [sessions[0], sessions[0]]), /Repeated or missing session/);
    } finally {
      await client.query("rollback");
    }
    for (const [invalid, expected] of [
      [{ ...input, household: randomUUID() }, /Pickup household mismatch/],
      [{ ...input, guardian: outsider }, /Pickup person is not authorized/],
    ] as const) {
      await client.query("begin");
      try {
        await client.query("set local role service_role");
        await assert.rejects(release(client, invalid), expected);
      } finally {
        await client.query("rollback");
      }
    }
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await assert.rejects(release(client, input, [sessions[0], adultSession.id]),
        /Only dependents may be released/);
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      await client.query(`create function pg_temp.fail_second_release() returns trigger language plpgsql as
        'begin if old.id = ''${sessions[1]}'' then raise exception ''injected release failure''; end if; return new; end'`);
      await client.query(`create trigger fail_second_release before update on public.checkin_sessions
        for each row execute function pg_temp.fail_second_release()`);
      await client.query("set local role service_role");
      await assert.rejects(release(client, input), /injected release failure/);
    } finally {
      await client.query("rollback");
    }
    const before = await one<{ open: string }>(client,
      `select count(*)::text as open from public.checkin_sessions
        where id = any($1::uuid[]) and status = 'checked_in'`, [sessions]);
    assert.equal(before.open, "2");

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      assert.equal((await release(client, input)).released, 2);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    const after = await one<{ closed: string }>(client,
      `select count(*)::text as closed from public.checkin_sessions
        where id = any($1::uuid[]) and status = 'checked_out' and checked_out_by = $2`,
      [sessions, staff]);
    assert.equal(after.closed, "2");

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await assert.rejects(release(client, input), /Selected check-ins changed/);
    } finally {
      await client.query("rollback");
    }
  });
});
