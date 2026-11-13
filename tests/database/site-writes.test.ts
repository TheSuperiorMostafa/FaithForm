import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A local PGlite installation exercises real PostgreSQL with no listening
// server, production credentials, customer rows, or network requests.
// FAITHFORM_TEST_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js
const modulePath = process.env.FAITHFORM_TEST_PGLITE_MODULE;
const options = modulePath ? {} : {skip:"Select a local FAITHFORM_TEST_PGLITE_MODULE for isolated PostgreSQL verification."};

test("website writes commit atomically and keep tenant content intact", options, async t => {
  const {PGlite} = await import(modulePath!);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.churches(id uuid primary key, name text, slug text, denomination text, logo_url text, cover_image_url text, address text, city text, state text, zip text, phone text, email text, google_maps_url text, mission_statement text, vision_statement text, ai_knowledge jsonb default '{}',office_hours jsonb default '{}');
      create table public.church_users(church_id uuid references churches(id),user_id uuid references auth.users(id),role text);
      create table public.announcements(id uuid primary key);
      create table public.church_settings(church_id uuid primary key,denomination text);
      create table public.voice_assistant_settings(church_id uuid primary key,denomination text,church_phone text,office_hours jsonb default '{}');
      create table public.church_service_times(id uuid primary key,church_id uuid references churches(id) on delete cascade,label text not null,day_of_week smallint not null check(day_of_week between 0 and 6),start_time time not null,end_time time,kind text default 'regular',notes text,sort_order integer,updated_at timestamptz);
      create table public.church_staff(id uuid primary key,church_id uuid references churches(id) on delete cascade,full_name text not null,title text,bio text,photo_url text,is_public boolean,sort_order integer,email text,phone text,is_senior_pastor boolean default false,updated_at timestamptz);
    `);
    await db.exec(readFileSync("supabase/migrations/0002_rls_policies.sql","utf8").split("-- ENABLE RLS")[0]);
    for (const name of ["0041_team_access_and_feature_flags.sql","0042_church_sites.sql","0044_site_domain_requests.sql","0112_site_layout_mode.sql","0161_website_atomic_writes.sql","0162_website_server_writes.sql"]) {
      // Production already has this signature returning text. Replacing it
      // must retain its contract rather than require dropping a live RPC.
      if(name==="0161_website_atomic_writes.sql") await db.exec("create function public.set_site_publication(p_church_id uuid,p_published boolean) returns text language sql as $$ select 'legacy'::text $$;");
      if(name==="0162_website_server_writes.sql") await db.exec("grant all on all tables in schema public to anon,authenticated,service_role;");
      await db.exec(readFileSync(`supabase/migrations/${name}`,"utf8"));
    }
    const church="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
    await db.query("insert into churches(id,name,slug,ai_knowledge) values($1,'Original','atomic-site','{\"private\":\"keep\"}'),($2,'Other','other-site','{}')",[church,other]);
    const draft={title:"Our church",metaDescription:"Welcome",sections:[{type:"site_nav",isVisible:true,props:{}},{type:"about_text",isVisible:true,props:{body:["Original"]}}]};
    const create=(value=draft,theme="grace")=>db.query("select create_site_draft($1,$2,$3,$4) as created",[church,theme,JSON.stringify(value),"hello@example.invalid"]);
    let ids: string[]=[];
    await t.test("failed creation leaves no settings, page or partial sections; retry and duplicate preserve existing design",async()=>{
      await assert.rejects(create({...draft,sections:[...draft.sections,{type:null as unknown as string,isVisible:true,props:{}}]}));
      assert.equal((await db.query("select count(*)::int as n from site_pages")).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int as n from site_settings")).rows[0].n,0);
      // Recover an empty draft left by the old multi-request creation path.
      await db.query("insert into site_pages(church_id,path,title,status) values($1,'/','Keep this page title','draft')",[church]);
      assert.equal((await create()).rows[0].created,true);
      assert.equal((await db.query("select title from site_pages where church_id=$1",[church])).rows[0].title,"Keep this page title");
      assert.equal((await create(draft,"classic")).rows[0].created,false);
      assert.equal((await db.query("select theme_key from site_settings where church_id=$1",[church])).rows[0].theme_key,"grace");
      ids=(await db.query("select id from site_sections where church_id=$1 order by sort_order",[church])).rows.map((r:{id:string})=>r.id);
    });
    await t.test("publication failure rolls every page back and taking offline retains content",async()=>{
      await db.exec("create function reject_site_publication() returns trigger language plpgsql as $$ begin if new.is_published then raise exception 'injected failure'; end if; return new; end $$; create trigger reject_publication before update on site_settings for each row execute function reject_site_publication();");
      await assert.rejects(db.query("select set_site_publication($1,true)",[church]),/injected failure/);
      assert.equal((await db.query("select status from site_pages where church_id=$1",[church])).rows[0].status,"draft");
      await db.exec("drop trigger reject_publication on site_settings;");
      assert.equal((await db.query("select set_site_publication($1,true) as result",[church])).rows[0].result,"published");
      assert.equal((await db.query("select is_published from site_settings where church_id=$1",[church])).rows[0].is_published,true);
      assert.equal((await db.query("select set_site_publication($1,false) as result",[church])).rows[0].result,"unpublished");
      assert.equal((await db.query("select count(*)::int as n from site_sections where church_id=$1",[church])).rows[0].n,2);
    });
    await t.test("reorder refuses partial/duplicate/cross-church sets without changing any position",async()=>{
      await assert.rejects(db.query("select reorder_site_sections($1,$2)",[church,[ids[0]]]));
      await assert.rejects(db.query("select reorder_site_sections($1,$2)",[church,[ids[0],ids[0]]]));
      await assert.rejects(db.query("select reorder_site_sections($1,$2)",[other,ids]));
      await db.query("select reorder_site_sections($1,$2)",[church,ids.slice().reverse()]);
      assert.deepEqual((await db.query("select id from site_sections where church_id=$1 order by sort_order",[church])).rows.map((r:{id:string})=>r.id),ids.slice().reverse());
    });
    await t.test("section edits upsert without duplication, reset atomically, and reject another church or trusted HTML",async()=>{
      for(const body of ["First","Second"]) await db.query("select save_site_section_patch($1,$2,$3)",[church,ids[1],JSON.stringify({body:[body]})]);
      assert.deepEqual((await db.query("select patch from site_overrides where section_id=$1",[ids[1]])).rows,[{patch:{body:["Second"]}}]);
      await assert.rejects(db.query("select save_site_section_patch($1,$2,'{}')",[other,ids[1]]));
      await db.query("select save_site_section_patch($1,$2,'{}')",[church,ids[1]]);
      assert.equal((await db.query("select count(*)::int as n from site_overrides")).rows[0].n,0);
    });
    await t.test("layout failure rolls back moves and page creation; round trip retains page metadata and patches",async()=>{
      const home=(await db.query("select id from site_pages where church_id=$1 and path='/'",[church])).rows[0].id;
      const plan=ids.map((id,index)=>({id,sourcePageId:home,path:index===1?"/about":"/",title:"About",sortOrder:index*10,landingSortOrder:index*10,props:{}}));
      await assert.rejects(db.query("select apply_site_layout($1,'website',$2)",[church,JSON.stringify([plan[0],{...plan[1],path:"/invalid"}])]));
      assert.equal((await db.query("select count(*)::int as n from site_pages where church_id=$1",[church])).rows[0].n,1);
      await db.query("select apply_site_layout($1,'website',$2)",[church,JSON.stringify(plan)]);
      const about=(await db.query("select id from site_pages where church_id=$1 and path='/about'",[church])).rows[0].id;
      await db.query("update site_pages set title='Our custom title',meta_description='Keep this' where id=$1",[about]);
      await db.query("insert into site_overrides(church_id,scope,page_id,patch) values($1,'page',$2,'{\"sections\":{\"about_text\":{\"eyebrow\":\"Page copy\"}}}')",[church,about]);
      const collapse=plan.map((p,index)=>({...p,sourcePageId:index===1?about:home,path:"/",...(index===1?{patch:{eyebrow:"Page copy"}}:{})}));
      await db.query("select apply_site_layout($1,'landing',$2)",[church,JSON.stringify(collapse)]);
      assert.deepEqual((await db.query("select title,meta_description from site_pages where id=$1",[about])).rows,[{title:"Our custom title",meta_description:"Keep this"}]);
      assert.equal((await db.query("select count(*)::int as n from site_overrides where church_id=$1",[church])).rows[0].n,2);
      await assert.rejects(db.query("select apply_site_layout($1,'website',$2)",[church,JSON.stringify(collapse.map(p=>({...p,sourcePageId:about})))]));
    });
    await t.test("profile details preserve unrelated facts and identities on retry; invalid children roll back the profile",async()=>{
      const service="33333333-3333-4333-8333-333333333333",staff="44444444-4444-4444-8444-444444444444";
      const details={name:"Updated",serviceTimes:[{id:service,label:"Worship",dayOfWeek:0,startTime:"10:30"}],staff:[{id:staff,fullName:"Pastor",title:"",bio:"",photoUrl:"",isPublic:true}]};
      await db.query("update churches set email='old@example.invalid' where id=$1;",[church]);
      await db.query("update site_settings set contact_email='old@example.invalid' where church_id=$1",[church]);
      await db.query("select save_site_details($1,$2)",[church,JSON.stringify(details)]);
      assert.equal((await db.query("select contact_email from site_settings where church_id=$1",[church])).rows[0].contact_email,null);
      await db.query("update site_settings set contact_email='separate-inbox@example.invalid' where church_id=$1",[church]);
      await db.query("update church_staff set email='private@example.invalid',is_senior_pastor=true where id=$1",[staff]);
      await db.query("update church_service_times set notes='Keep notes',end_time='12:00' where id=$1",[service]);
      await db.query("select save_site_details($1,$2)",[church,JSON.stringify(details)]);
      assert.equal((await db.query("select contact_email from site_settings where church_id=$1",[church])).rows[0].contact_email,"separate-inbox@example.invalid");
      assert.deepEqual((await db.query("select email,is_senior_pastor from church_staff where id=$1",[staff])).rows,[{email:"private@example.invalid",is_senior_pastor:true}]);
      assert.deepEqual((await db.query("select notes,end_time from church_service_times where id=$1",[service])).rows,[{notes:"Keep notes",end_time:"12:00:00"}]);
      await assert.rejects(db.query("select save_site_details($1,$2)",[church,JSON.stringify({...details,name:"Should roll back",serviceTimes:[{...details.serviceTimes[0],dayOfWeek:9}]})]));
      assert.deepEqual((await db.query("select name,ai_knowledge from churches where id=$1",[church])).rows,[{name:"Updated",ai_knowledge:{private:"keep"}}]);
      await assert.rejects(db.query("select save_site_details($1,$2)",[other,JSON.stringify(details)]));
    });
    await t.test("anonymous and signed-in browser roles cannot invoke writes or directly attach foreign sections",async()=>{
      for(const signature of ["create_site_draft(uuid,text,jsonb,text)","set_site_publication(uuid,boolean)","reorder_site_sections(uuid,uuid[])","save_site_section_patch(uuid,uuid,jsonb)","apply_site_layout(uuid,text,jsonb)","save_site_details(uuid,jsonb)"]) {
        assert.deepEqual((await db.query("select has_function_privilege('anon',$1,'EXECUTE') as anon,has_function_privilege('authenticated',$1,'EXECUTE') as member,has_function_privilege('service_role',$1,'EXECUTE') as service",[`public.${signature}`])).rows,[{anon:false,member:false,service:true}]);
      }
      for(const table of ["site_pages","site_sections","site_overrides","site_settings"]) assert.equal((await db.query("select has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') as write",[table])).rows[0].write,false);
      await db.exec("set role authenticated;");
      try { await assert.rejects(db.query("insert into site_sections(church_id,page_id,type) select $1,id,'hero' from site_pages limit 1",[church]),/permission denied/); }
      finally { await db.exec("reset role;"); }
      await db.exec("set role service_role;");
      try { await db.query("select set_site_publication($1,true)",[church]); }
      finally { await db.exec("reset role;"); }
    });
    await t.test("direct reads enforce Website access and visitor messages cannot be rewritten outside the inbox action",async()=>{
      const user="55555555-5555-4555-8555-555555555555";
      await db.query("insert into auth.users(id) values($1)",[user]);
      await db.query("insert into church_users(church_id,user_id,role,feature_permissions) values($1,$2,'staff','{}')",[church,user]);
      await db.query("select create_site_draft($1,'grace',$2,null)",[other,JSON.stringify(draft)]);
      for(const id of [church,other]) {
        await db.query("insert into site_media(church_id,title) values($1,'Private draft')",[id]);
        await db.query("insert into site_contact_submissions(church_id,name,email,message) values($1,'Visitor','safe@example.invalid','Private enquiry')",[id]);
        await db.query("insert into site_domains(church_id,hostname) values($1,$2)",[id,`${id}.example.invalid`]);
        await db.query("insert into site_domain_requests(church_id,kind,hostname) values($1,'connect_existing',$2)",[id,`${id}.example.invalid`]);
      }
      const tables=["site_settings","site_pages","site_sections","site_overrides","site_media","site_contact_submissions","site_domains","site_domain_requests"];
      const readAsUser=async(expectedChurch:string|null)=>{
        await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
        await db.exec("set role authenticated;");
        try {
          for(const table of tables) {
            const rows=(await db.query(`select distinct church_id from ${table}`)).rows;
            assert.deepEqual(rows.map((r:{church_id:string})=>r.church_id),expectedChurch?[expectedChurch]:[],`${table} must honor feature grants and tenant scope`);
          }
        } finally { await db.exec("reset role;"); }
      };
      await readAsUser(null);
      await db.query("update church_users set feature_permissions='{website}' where user_id=$1",[user]);
      await readAsUser(church);
      await db.query("insert into church_features(church_id,feature_key,enabled) values($1,'website',false)",[church]);
      await readAsUser(null);
      await db.query("update church_features set enabled=true where church_id=$1",[church]);
      await db.query("update church_users set role='admin',feature_permissions='{}' where user_id=$1",[user]);
      await readAsUser(church);
      for(const table of [...tables,"site_themes"]) {
        for(const role of ["anon","authenticated"]) {
          assert.equal((await db.query("select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as write",[role,table])).rows[0].write,false,`${role} must not bypass server validation on ${table}`);
        }
      }
      await db.exec("set role anon;");
      try {
        for(const table of tables) assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0,`anonymous ${table} read must expose no drafts or visitor data`);
        await assert.rejects(db.exec("truncate site_contact_submissions"),/permission denied/);
      } finally { await db.exec("reset role;"); }
      await db.exec("set role authenticated;");
      try {
        await assert.rejects(db.query("update site_contact_submissions set message='Rewritten enquiry' where church_id=$1",[church]),/permission denied/);
        await assert.rejects(db.query("insert into site_media(church_id,title,video_url) values($1,'Unsafe sermon','javascript:alert(1)')",[church]),/permission denied/);
      } finally { await db.exec("reset role;"); }
    });
  } finally { await db.close(); }
});
