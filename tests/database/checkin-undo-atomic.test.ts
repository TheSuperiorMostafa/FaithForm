import assert from "node:assert/strict";
import test from "node:test";

import { asUser, one, person, staffUser, suiteOptions, withChurch, type Client } from "./groups-fixtures";

async function undo(client: Client, churchId: string, sessionIds: string[], staffId: string) {
  return one<{ undone: number }>(client,
    `select public.undo_checkin_sessions($1, $2::uuid[], $3) as undone`,
    [churchId, sessionIds, staffId]);
}

test("multi-child check-in undo is all or nothing", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const room = await one<{ id: string }>(client,
      `insert into public.church_locations (church_id, name) values ($1, 'QA Room') returning id`,
      [church.id]);
    const sessionIds: string[] = [];
    for (const name of ["Child One", "Child Two"]) {
      const memberId = await person(client, church.id, name, "Test");
      const session = await one<{ id: string }>(client,
        `insert into public.checkin_sessions
           (church_id, member_id, location_id, local_service_date, status,
            checked_in_at, checked_in_by)
         values ($1, $2, $3, current_date, 'checked_in', now(), $4) returning id`,
        [church.id, memberId, room.id, staff]);
      sessionIds.push(session.id);
    }

    await asUser(client, staff, async () => {
      await assert.rejects(undo(client, church.id, sessionIds, staff),
        (error: unknown) => (error as { code?: string }).code === "42501");
    });

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await assert.rejects(undo(client, church.id, [sessionIds[0], sessionIds[0]], staff),
        /Repeated or missing session/);
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      await client.query(`create function pg_temp.fail_second_undo() returns trigger language plpgsql as
        'begin if old.id = ''${sessionIds[1]}'' then raise exception ''injected undo failure''; end if; return new; end'`);
      await client.query(`create trigger fail_second_undo before update on public.checkin_sessions
        for each row execute function pg_temp.fail_second_undo()`);
      await client.query("set local role service_role");
      await assert.rejects(undo(client, church.id, sessionIds, staff), /injected undo failure/);
    } finally {
      await client.query("rollback");
    }
    const unchanged = await one<{ checked_in: string }>(client,
      `select count(*)::text as checked_in from public.checkin_sessions
        where id = any($1::uuid[]) and status = 'checked_in'`, [sessionIds]);
    assert.equal(unchanged.checked_in, "2");

    await client.query("begin");
    try {
      await client.query(`update public.checkin_sessions
        set status = 'checked_out', checked_out_at = now() where id = $1`, [sessionIds[1]]);
      await client.query("set local role service_role");
      await assert.rejects(undo(client, church.id, sessionIds, staff), /Selected check-ins changed/);
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      assert.equal((await undo(client, church.id, sessionIds, staff)).undone, 2);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    const cancelled = await one<{ count: string }>(client,
      `select count(*)::text as count from public.checkin_sessions
        where id = any($1::uuid[]) and status = 'cancelled'`, [sessionIds]);
    assert.equal(cancelled.count, "2");
  });
});
