import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connect } from "./groups-fixtures";

const enabled = process.env.FAITHFORM_TEST_DATABASE_URL && (process.env.FAITHFORM_FULL_SCHEMA === "1" || process.env.FAITHFORM_UPCOMING_SCHEMA === "1");
const options = enabled ? {} : { skip: "Needs an explicitly selected disposable upcoming-service database." };

async function fixture(body: (db: Awaited<ReturnType<typeof connect>>, church: string, event: string) => Promise<void>) {
  const db = await connect();
  const church = randomUUID(), event = randomUUID();
  try {
    await db.query("begin");
    await db.query("insert into public.churches(id,name,slug,timezone) values ($1,'Upcoming test',$1::uuid::text,'America/New_York')", [church]);
    // The first Sunday in March next year precedes the DST transition.
    await db.query(`insert into public.stream_events(id,church_id,title,starts_at,recurrence_rule,speaker_tags,description,recording_app_visibility,recording_publish_to_website)
      values ($1,$2,'Weekly service',
        ((date_trunc('year',now())::date + interval '1 year 2 months')::date +
          ((7-extract(dow from (date_trunc('year',now())::date + interval '1 year 2 months'))::integer)%7) + time '10:30') at time zone 'America/New_York',
        'weekly',array['Original speaker'],'Original description','followers',false)`, [event,church]);
    await body(db,church,event);
  } finally { await db.query("rollback"); await db.end(); }
}

test("weekly schedules persist ten distinct editable occurrences at the church's time across DST", options, async () => {
  await fixture(async (db,church,event) => {
    const { rows } = await db.query("select id,recurrence_group_id,to_char(starts_at at time zone 'America/New_York','HH24:MI') as clock,extract(timezone from starts_at) as offset,starts_at from public.stream_events where church_id=$1 order by starts_at",[church]);
    assert.equal(rows.length,10);
    assert.equal(new Set(rows.map(row=>row.id)).size,10);
    assert.ok(rows.every(row=>row.recurrence_group_id===event && row.clock==='10:30'));
    assert.equal(Date.parse(String(rows[1].starts_at))-Date.parse(String(rows[0].starts_at)),167*60*60*1000);
    const { rows:[privileges] } = await db.query("select has_function_privilege('anon','public.maintain_upcoming_service_horizon()','EXECUTE') as anon,has_function_privilege('authenticated','public.maintain_upcoming_service_horizon()','EXECUTE') as customer");
    assert.deepEqual(privileges,{anon:false,customer:false});
  });
});

test("editing one week leaves the other nine unchanged and does not change future generated defaults", options, async () => {
  await fixture(async (db,church,event) => {
    await db.query("update public.stream_events set title='One week only',speaker_tags=array['Guest speaker'],recording_app_visibility='none',recording_publish_to_website=true where id=$1 and church_id=$2",[event,church]);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1 and title='Weekly service' and speaker_tags=array['Original speaker'] and recording_app_visibility='followers' and recording_publish_to_website=false",[church])).rowCount,9);
    await db.query("update public.stream_events set status='live' where id=$1",[event]);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1 and status='scheduled'",[church])).rowCount,10);
    const { rows:[tail] }=await db.query("select title,speaker_tags,recording_app_visibility,recording_publish_to_website from public.stream_events where church_id=$1 order by starts_at desc limit 1",[church]);
    assert.deepEqual(tail,{title:'Weekly service',speaker_tags:['Original speaker'],recording_app_visibility:'followers',recording_publish_to_website:false});
    await db.query("update public.stream_events set status='ended' where id=$1",[event]);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1",[church])).rowCount,11);
  });
});

test("cancelling one week keeps the cancelled date out and replenishes the tail without duplicates", options, async () => {
  await fixture(async (db,church,event) => {
    await db.query("update public.stream_events set status='cancelled' where id=$1",[event]);
    await db.query("update public.stream_events set status='cancelled' where id=$1",[event]);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1 and status='scheduled'",[church])).rowCount,10);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1 and status='cancelled'",[church])).rowCount,1);
    assert.equal((await db.query("select starts_at from public.stream_events where church_id=$1 group by starts_at having count(*)>1",[church])).rowCount,0);
  });
});

test("church ownership and existing RLS apply to every generated occurrence", options, async () => {
  await fixture(async (db,church,event) => {
    const otherChurch=randomUUID(), user=randomUUID();
    await db.query("insert into public.churches(id,name,slug) values ($1,'Other church',$1::uuid::text)",[otherChurch]);
    await db.query("insert into auth.users(id,email) values ($1,'upcoming@example.test')",[user]);
    await db.query("insert into public.church_users(church_id,user_id,role) values ($1,$2,'admin')",[otherChurch,user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
    await db.query("set local role authenticated");
    assert.equal((await db.query("update public.stream_events set title='Cross-church edit' where id=$1",[event])).rowCount,0);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1",[church])).rowCount,0);
    await db.query("insert into public.stream_events(church_id,title,starts_at,recurrence_rule) values ($1,'Other weekly',now()+interval '1 day','weekly')",[otherChurch]);
    assert.equal((await db.query("select id from public.stream_events where church_id=$1",[otherChurch])).rowCount,10);
    await db.query("reset role");
    assert.equal((await db.query("select id from public.stream_events where church_id=$1",[church])).rowCount,10);
  });
});

test("concurrent changes replenish one shared horizon without duplicate weeks", options, async () => {
  const first=await connect(), second=await connect(), church=randomUUID();
  try {
    await first.query("insert into public.churches(id,name,slug) values ($1,'Concurrent weekly',$1::uuid::text)",[church]);
    await first.query("insert into public.stream_events(church_id,title,starts_at,recurrence_rule) values ($1,'Weekly',now()+interval '1 day','weekly')",[church]);
    const {rows}=await first.query("select id from public.stream_events where church_id=$1 order by starts_at",[church]);
    await Promise.all([
      first.query("update public.stream_events set status='cancelled' where id=$1",[rows[0].id]),
      second.query("update public.stream_events set status='cancelled' where id=$1",[rows[1].id]),
    ]);
    assert.equal((await first.query("select id from public.stream_events where church_id=$1 and status='scheduled'",[church])).rowCount,10);
    assert.equal((await first.query("select starts_at from public.stream_events where church_id=$1 group by starts_at having count(*)>1",[church])).rowCount,0);
  } finally {
    await first.query("delete from public.churches where id=$1",[church]);
    await first.end(); await second.end();
  }
});

test("the forward migration expands existing weekly schedules without changing their first week's edits", options, async () => {
  const db=await connect(), church=randomUUID(), event=randomUUID();
  try {
    await db.query("begin");
    await db.query("drop trigger maintain_upcoming_service_horizon on public.stream_events");
    await db.query("insert into public.churches(id,name,slug) values ($1,'Legacy weekly',$1::uuid::text)",[church]);
    await db.query("insert into public.stream_events(id,church_id,title,starts_at,recurrence_rule,artwork_url) values ($1,$2,'Already prepared',now()+interval '1 day','weekly','https://example.test/cover.jpg')",[event,church]);
    await db.query(readFileSync("supabase/migrations/0141_upcoming_service_horizon.sql","utf8"));
    const {rows}=await db.query("select id,title,artwork_url from public.stream_events where church_id=$1",[church]);
    assert.equal(rows.length,10);
    assert.ok(rows.some(row=>row.id===event));
    assert.ok(rows.every(row=>row.title==='Already prepared' && row.artwork_url==='https://example.test/cover.jpg'));
  } finally { await db.query("rollback"); await db.end(); }
});
