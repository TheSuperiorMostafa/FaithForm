import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "pg";

const url = process.env.FAITHFORM_TEST_DATABASE_URL;
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Use a disposable local database.");

test("service links preserve the published version, audiences, tenant boundaries, and live-to-replay handoff", { skip: !url && "Set FAITHFORM_TEST_DATABASE_URL to a disposable database" }, async () => {
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query("begin");
  try {
    const church = randomUUID(), other = randomUUID(), user = randomUUID();
    const sermon = randomUUID(), version = randomUUID(), nextVersion = randomUUID(), otherVersion = randomUUID();
    const event = randomUUID(), recording = randomUUID();
    const slug = `links-${church}`;
    await db.query("insert into public.churches(id,name,slug) values ($1,'Link Church',$2),($3,'Other Church',$4)", [church,slug,other,`links-${other}`]);
    await db.query("insert into auth.users(id,email) values ($1,'links@example.test')", [user]);
    await db.query("insert into public.sermons(id,church_id,created_by,title,mobile_visibility,mobile_published_at) values ($1,$2,$3,'Shared sermon','public',now())", [sermon,church,user]);
    for (const [id, v] of [[version,1],[nextVersion,2]] as const) {
      await db.query(`insert into public.sermon_presentation_versions(id,sermon_id,church_id,version,content_hash,manifest,mobile_visibility)
        values ($1,$2,$3,$4,$5,'{"pages":[{"id":"slide1"}]}','public')`, [id,sermon,church,v,`hash-${v}`]);
    }
    await db.query("insert into public.stream_events(id,church_id,title,starts_at,status,mobile_visibility,mobile_published_at) values($1,$2,'Sunday service',now(),'live','public',now())", [event,church]);
    await db.query("insert into public.stream_event_presentations(event_id,church_id,presentation_id) values($1,$2,$3)", [event,church,version]);
    const slides = async (relationship: string | null = null, kind = 'live', id = event, churchSlug = slug) =>
      (await db.query("select * from public.mobile_media_presentation($1,$2,$3,$4)", [churchSlug,relationship,kind,id])).rows;
    const services = async (relationship: string | null = null, presentation: string | null = version) =>
      (await db.query("select * from public.mobile_sermon_services($1,$2,$3,$4)", [slug,relationship,presentation ? null : sermon,presentation])).rows;
    assert.equal((await slides())[0].presentation_id, version, "link drifted to newest version");
    assert.equal((await services())[0].kind, 'live');
    assert.equal((await services(null, null))[0].media_id, event, "notes must also link back");
    assert.deepEqual(await services(null, nextVersion), [], "unused version claimed the stream");
    assert.deepEqual(await slides('blocked'), []);
    assert.deepEqual(await services('blocked'), []);
    assert.deepEqual(await slides(null,'live',event,`links-${other}`), []);
    await db.query("update public.sermon_presentation_versions set mobile_visibility='members' where id=$1", [version]);
    assert.deepEqual(await slides(), []);
    assert.deepEqual(await slides('following'), []);
    assert.equal((await slides('joined'))[0].presentation_id, version);
    assert.deepEqual(await services(), []);
    await db.query("update public.sermon_presentation_versions set mobile_visibility='public',unpublished_at=now() where id=$1", [version]);
    assert.deepEqual(await slides('joined'), []);
    await db.query("update public.sermon_presentation_versions set unpublished_at=null where id=$1", [version]);
    await db.query("update public.stream_events set mobile_visibility='members' where id=$1", [event]);
    assert.deepEqual(await services(), []);
    assert.equal((await services('joined'))[0].kind, 'live');
    await db.query("update public.stream_events set mobile_visibility='public' where id=$1", [event]);
    // Publication alone is insufficient: the replay must be verified playable.
    await db.query(`insert into public.stream_recordings(id,church_id,stream_event_id,title,status,storage_path,duration_sec,mobile_visibility,mobile_published_at)
      values($1,$2,$3,'Sunday replay','ready','recordings/test.mp4',3600,'public',now())`, [recording,church,event]);
    await db.query("update public.stream_events set status='ended' where id=$1", [event]);
    assert.deepEqual(await services(), [], "unverified recording leaked through the link");
    await db.query(`select * from public.record_recording_rendition($1,$2,true,'progressive','ok','isom','avc1','mp4a','avc1.4d401f','mp4a.40.2',48000,2::smallint,1024::bigint,'etag',null,$3)`, [recording,church,'a'.repeat(64)]);
    assert.equal((await services())[0].media_id, recording);
    assert.equal((await services())[0].kind, 'recording');
    assert.equal((await slides(null,'recording',recording))[0].presentation_id, version);
    await db.query("update public.stream_events set status='live' where id=$1", [event]);
    assert.equal((await services())[0].kind, 'live', "live must win over an available replay");
    await db.query("update public.stream_events set status='ended' where id=$1", [event]);
    await db.query("update public.stream_recordings set mobile_unpublished_at=now() where id=$1", [recording]);
    assert.deepEqual(await services(), []);
    assert.deepEqual(await slides(null,'recording',recording), []);
    // Direct API users cannot write around the admin-only route.
    assert.equal((await db.query("select has_table_privilege('authenticated','public.stream_event_presentations','INSERT') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.mobile_sermon_services(text,text,uuid,uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
    const otherSermon=randomUUID();
    await db.query("insert into public.sermons(id,church_id,created_by,title) values($1,$2,$3,'Other sermon')", [otherSermon,other,user]);
    await db.query(`insert into public.sermon_presentation_versions(id,sermon_id,church_id,version,content_hash,manifest,mobile_visibility)
      values($1,$2,$3,1,'other','{"pages":[]}','public')`,[otherVersion,otherSermon,other]);
    await db.query("savepoint wrong_church");
    await assert.rejects(db.query("update public.stream_event_presentations set presentation_id=$1 where event_id=$2",[otherVersion,event]), /same church/);
    await db.query("rollback to savepoint wrong_church");
    await db.query("delete from public.stream_event_presentations where event_id=$1",[event]);
    assert.deepEqual(await slides(), []);
    assert.deepEqual(await services('joined'), []);
  } finally { await db.query("rollback"); await db.end(); }
});
