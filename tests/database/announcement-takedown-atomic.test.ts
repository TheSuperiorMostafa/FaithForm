import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { authUser, suiteOptions, withChurch } from "./groups-fixtures";

test("takedown removes only its church/event queue, is repeatable, and retains recovery state", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const actor = await authUser(client);
    const outsider = await authUser(client);
    const announcement = randomUUID();
    try {
      await client.query("insert into public.church_users (church_id,user_id,role) values ($1,$2,'admin')", [church.id, actor]);
      await client.query("insert into public.announcements (id,church_id,event_title,title,status,is_ready,push_to_team,google_event_id,facebook_post_id) values ($1,$2,'Event','Event','published',true,true,'event-taken-down','facebook-live')", [announcement, church.id]);
      await client.query("insert into public.announcement_email_queue (church_id,week_start,google_event_id) values ($1,'2026-10-05','event-taken-down'),($1,'2026-10-12','event-taken-down'),($1,'2026-10-05','unrelated-event')", [church.id]);
      for (const role of ["anon", "authenticated"]) {
        const grants = await client.query("select has_function_privilege($1, 'public.take_down_announcement(uuid,uuid,uuid,boolean)', 'EXECUTE') as allowed", [role]);
        assert.equal(grants.rows[0].allowed, false);
      }
      await client.query("set role service_role");
      await assert.rejects(client.query("select public.take_down_announcement($1,$2,$3,true)", [church.id, announcement, outsider]), /forbidden/);
      for (let retry = 0; retry < 2; retry++) {
        const result = await client.query("select public.take_down_announcement($1,$2,$3,true) as ok", [church.id, announcement, actor]);
        assert.equal(result.rows[0].ok, true);
      }
      await client.query("reset role");
      const row = (await client.query("select * from public.announcements where id=$1", [announcement])).rows[0];
      assert.equal(row.status, "pending");
      assert.equal(row.push_to_team, false);
      assert.equal(row.facebook_post_id, "facebook-live");
      assert.equal(row.unsubmitted_by, actor);
      assert.ok(row.unsubmitted_at);
      const queue = await client.query("select google_event_id from public.announcement_email_queue where church_id=$1", [church.id]);
      assert.deepEqual(queue.rows.map(row => row.google_event_id), ["unrelated-event"]);
    } finally {
      await client.query("reset role");
      await client.query("delete from auth.users where id=$1", [outsider]);
    }
  });
});

test("a church administrator cannot take down another church's announcement", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const actor = await authUser(client);
    const otherChurch = randomUUID();
    const announcement = randomUUID();
    try {
      await client.query("insert into public.church_users (church_id,user_id,role) values ($1,$2,'admin')", [church.id, actor]);
      await client.query("insert into public.churches (id,name,slug) values ($1,'Other church',$2)", [otherChurch, `takedown-${otherChurch}`]);
      await client.query("insert into public.announcements (id,church_id,event_title,status,push_to_team,google_event_id) values ($1,$2,'Other event','published',true,'shared-event-id')", [announcement, otherChurch]);
      await client.query("insert into public.announcement_email_queue (church_id,week_start,google_event_id) values ($1,'2026-10-05','shared-event-id')", [otherChurch]);
      await client.query("set role service_role");
      const result = await client.query("select public.take_down_announcement($1,$2,$3,false) as ok", [church.id, announcement, actor]);
      assert.equal(result.rows[0].ok, false);
      await assert.rejects(client.query("select public.take_down_announcement($1,$2,$3,false)", [otherChurch, announcement, actor]), /forbidden/);
      await client.query("reset role");
      assert.equal((await client.query("select status from public.announcements where id=$1", [announcement])).rows[0].status, "published");
      assert.equal((await client.query("select id from public.announcement_email_queue where church_id=$1", [otherChurch])).rowCount, 1);
    } finally {
      await client.query("reset role");
      await client.query("delete from public.churches where id=$1", [otherChurch]);
    }
  });
});

test("queue-delete failure rolls back announcement rewind", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const actor = await authUser(client);
    const announcement = randomUUID();
    await client.query("insert into public.church_users (church_id,user_id,role) values ($1,$2,'admin')", [church.id, actor]);
    await client.query("insert into public.announcements (id,church_id,event_title,status,is_ready,push_to_team,google_event_id) values ($1,$2,'Event','published',true,true,'delete-failure')", [announcement, church.id]);
    await client.query("insert into public.announcement_email_queue (church_id,week_start,google_event_id) values ($1,'2026-10-05','delete-failure')", [church.id]);
    await client.query("begin");
    try {
      await client.query(`create function public.test_takedown_delete_failure() returns trigger language plpgsql as $$ begin raise exception 'injected queue deletion failure'; end $$`);
      await client.query("create trigger test_takedown_delete_failure before delete on public.announcement_email_queue for each row execute function public.test_takedown_delete_failure()");
      await client.query("savepoint before_takedown");
      await assert.rejects(client.query("select public.take_down_announcement($1,$2,$3,false)", [church.id, announcement, actor]), /injected queue deletion failure/);
      await client.query("rollback to savepoint before_takedown");
      const row = (await client.query("select status,push_to_team from public.announcements where id=$1", [announcement])).rows[0];
      assert.equal(row.status, "published");
      assert.equal(row.push_to_team, true);
      assert.equal((await client.query("select id from public.announcement_email_queue where church_id=$1", [church.id])).rowCount, 1);
    } finally {
      await client.query("rollback");
    }
  });
});
