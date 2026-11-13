import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modulePath = process.env.FAITHFORM_TEST_PGLITE_MODULE;
test("website recording publication delegates eligibility and updates only Sermons atomically", modulePath ? {} : { skip: "Select a local FAITHFORM_TEST_PGLITE_MODULE for isolated PostgreSQL verification." }, async t => {
  const { PGlite } = await import(modulePath!);
  const db = new PGlite();
  const church = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222", recording = "33333333-3333-4333-8333-333333333333";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create table churches(id uuid primary key);
      create table site_settings(church_id uuid primary key,is_published boolean,layout_mode text);
      create table site_pages(id uuid primary key default gen_random_uuid(),church_id uuid,path text,status text);
      create table site_sections(id uuid primary key default gen_random_uuid(),church_id uuid,page_id uuid,type text,is_visible boolean,props jsonb,sort_order integer);
      create table site_overrides(church_id uuid,scope text,page_id uuid,section_id uuid,patch jsonb);
      create table stream_recordings(id uuid primary key,church_id uuid,status text,title text,deleted_at timestamptz,mobile_playable boolean,mobile_rendition_verified_at timestamptz,
        mobile_rendition_revision integer,mobile_rendition_object_hash text,mobile_rendition_reason text,duration_sec numeric,trim_start_sec numeric default 0,trim_end_sec numeric,
        mobile_visibility text default 'none',mobile_published_at timestamptz,mobile_unpublished_at timestamptz,mobile_revoked_at timestamptz,mobile_poster_url text,mobile_summary text,
        web_published_at timestamptz,web_unpublished_at timestamptz);
      create table stream_media_publication_audit(church_id uuid,stream_recording_id uuid,action text,previous_visibility text,new_visibility text,actor_user_id uuid,via text);
    `);
    // Use the actual canonical publisher, not a substitute for its gates.
    const lifecycle = readFileSync("supabase/migrations/0095_livestream_recording_lifecycle.sql", "utf8");
    const begin = lifecycle.indexOf("create or replace function public.publish_recording(");
    const end = lifecycle.indexOf("/*\n * Takes a recording out", begin);
    assert.ok(begin > 0 && end > begin);
    await db.exec(lifecycle.slice(begin, end));
    await db.exec(readFileSync("supabase/migrations/0163_recordings_on_church_website.sql", "utf8"));
    await db.exec("grant select,insert,update on all tables in schema public to service_role;");
    await db.query("insert into churches values($1),($2);", [church, other]);
    await db.query("insert into site_settings values($1,true,'website'),($2,false,'landing')", [church, other]);
    await db.query("insert into site_pages(church_id,path,status) values($1,'/','published'),($1,'/sermons','draft'),($1,'/staff','draft'),($2,'/','draft')", [church, other]);
    await db.query("insert into site_sections(church_id,page_id,type,is_visible,props,sort_order) select $1,id,'site_nav',true,'{\"links\":[{\"label\":\"About\",\"href\":\"/about\"}],\"title\":\"Keep this\"}',30 from site_pages where church_id=$1 and path='/'", [church]);
    await db.query("insert into site_sections(church_id,page_id,type,is_visible,props,sort_order) select $1,id,'sermon_feed',false,'{\"headline\":{\"lead\":\"Keep my sermons copy\"}}',70 from site_pages where church_id=$1 and path='/sermons'", [church]);
    await db.query("insert into stream_recordings(id,church_id,status,title,mobile_playable,mobile_rendition_verified_at,mobile_rendition_revision,mobile_rendition_object_hash,duration_sec) values($1,$2,'ready','Sunday',false,now(),1,'hash',1800)", [recording, church]);
    const publish = (churchId = church) => db.query("select * from publish_recording_on_site($1,$2,null,true,null,null,1,'hash',null,'staff')", [recording, churchId]);
    await t.test("unverified and wrong-church recordings cannot enable a section or publish", async () => {
      assert.equal((await publish()).rows[0].ok, false);
      assert.equal((await publish(other)).rows[0].reason, "not_found");
      assert.equal((await db.query("select is_visible from site_sections where type='sermon_feed'")).rows[0].is_visible, false);
    });
    await db.query("update stream_recordings set mobile_playable=true where id=$1", [recording]);
    await t.test("a failure while enabling Sermons rolls back recording publication too", async () => {
      await db.exec("create function fail_section() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$; create trigger fail_section before update on site_sections for each row execute function fail_section();");
      await assert.rejects(publish(), /injected failure/);
      assert.equal((await db.query("select web_published_at from stream_recordings")).rows[0].web_published_at, null);
      await db.exec("drop trigger fail_section on site_sections;");
    });
    await t.test("publishing shows existing Sermons without changing other pages, copy or order", async () => {
      assert.equal((await publish()).rows[0].ok, true);
      const feed = (await db.query("select * from site_sections where type='sermon_feed'")).rows[0];
      assert.equal(feed.is_visible, true);
      assert.equal(feed.sort_order, 70);
      assert.equal(feed.props.headline.lead, "Keep my sermons copy");
      assert.equal((await db.query("select status from site_pages where path='/sermons'")).rows[0].status, "published");
      assert.equal((await db.query("select status from site_pages where path='/staff'")).rows[0].status, "draft");
      assert.deepEqual((await db.query("select props from site_sections where type='site_nav'")).rows[0].props, { title: "Keep this", links: [{ label: "About", href: "/about" }, { label: "Sermons", href: "/sermons" }] });
      await publish();
      assert.equal((await db.query("select jsonb_array_length(props->'links') n from site_sections where type='site_nav'")).rows[0].n, 2);
    });
    await t.test("a page-only publication reports its change and a repeated service-role request is idempotent", async () => {
      await db.exec("update site_pages set status='draft' where path='/sermons'; set role service_role;");
      try {
        const restored=(await publish()).rows[0];
        assert.equal(restored.ok,true);
        assert.equal(restored.changed,true);
        assert.equal(restored.reason,"ok");
        assert.equal((await db.query("select status from site_pages where path='/sermons'")).rows[0].status,"published");
        const repeated=(await publish()).rows[0];
        assert.equal(repeated.changed,false);
        assert.equal(repeated.reason,"unchanged");
        assert.equal((await db.query("select count(*)::int n from stream_media_publication_audit")).rows[0].n,1,"a page change does not republish the recording or duplicate its audit");
      } finally { await db.exec("reset role;"); }
    });
    await t.test("manual navigation omissions and an offline website remain intact", async () => {
      await db.exec("update site_sections set props=jsonb_set(props,'{links}','[]') where type='site_nav'; insert into site_overrides(church_id,scope,section_id,patch) select church_id,'section',id,'{\"links\":[]}' from site_sections where type='site_nav'; update site_settings set is_published=false; update site_pages set status='draft' where path='/sermons';");
      assert.equal((await publish()).rows[0].ok, true);
      assert.equal((await db.query("select is_published from site_settings where church_id=$1", [church])).rows[0].is_published, false);
      assert.equal((await db.query("select status from site_pages where path='/sermons'")).rows[0].status, "draft");
      assert.equal((await db.query("select jsonb_array_length(props->'links') n from site_sections where type='site_nav'")).rows[0].n, 0);
      assert.equal((await db.query("select has_function_privilege('authenticated','publish_recording_on_site(uuid,uuid,text,boolean,text,text,integer,text,uuid,text,timestamptz)','execute') allowed")).rows[0].allowed, false);
    });
  } finally { await db.close(); }
});
