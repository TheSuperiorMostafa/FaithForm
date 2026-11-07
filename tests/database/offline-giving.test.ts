import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const url = process.env.FAITHFORM_TEST_DATABASE_URL;
const options = url ? {} : { skip: "Select a disposable FAITHFORM_TEST_DATABASE_URL to observe offline giving writes." };
if (/prod|supabase\.co|amazonaws/i.test(url ?? "")) throw new Error("Refusing offline giving tests against a production-looking target.");

async function fixture() {
  const { Client } = await import("pg");
  const db = new Client({connectionString: url});
  await db.connect();
  const church = randomUUID(), otherChurch = randomUUID(), actor = randomUUID(), viewer = randomUUID(), fund = randomUUID(), otherFund = randomUUID();
  await db.query("insert into public.churches(id,name,slug) values ($1,'Offline giving test',$1::uuid::text),($2,'Other church',$2::uuid::text)", [church, otherChurch]);
  await db.query("insert into auth.users(id) values ($1),($2)", [actor, viewer]);
  await db.query("insert into public.church_users(church_id,user_id,role) values ($1,$2,'admin'),($1,$3,'viewer')", [church, actor, viewer]);
  await db.query("insert into public.giving_funds(id,church_id,name,slug) values ($1,$2,'General','general'),($3,$4,'Other','other')", [fund,church,otherFund,otherChurch]);
  const gift = {date:"2026-01-02",amount_cents:1001,fund_id:fund,donor_id:"",donor_name:"Jane Doe",donor_email:"JANE@example.org",method:"cash",gift_type:"one_time"};
  const record = (gifts: unknown, batch = randomUUID(), user = actor) => db.query("select public.record_offline_gifts($1,$2,$3,$4::jsonb) as count",[church,user,batch,JSON.stringify(gifts)]);
  return {db,church,otherChurch,actor,viewer,fund,otherFund,gift,record, async close() {
    await db.query("delete from public.churches where id=any($1::uuid[])",[[church,otherChurch]]);
    await db.query("delete from auth.users where id=any($1::uuid[])",[[actor,viewer]]);
    await db.end();
  }};
}

test("offline gifts preserve exact money and donor identity without creating provider payments", options, async () => {
  const f = await fixture();
  try {
    assert.equal((await f.record([f.gift])).rows[0].count,1);
    const {rows} = await f.db.query("select d.*, r.email from public.giving_donations d join public.giving_donors r on r.id=d.donor_id where d.church_id=$1",[f.church]);
    assert.equal(rows[0].amount_cents,1001); assert.equal(rows[0].net_amount_cents,1001); assert.equal(rows[0].stripe_fee_cents,0);
    assert.equal(rows[0].status,"succeeded"); assert.equal(rows[0].email,"jane@example.org");
    assert.equal(rows[0].stripe_payment_intent_id,null); assert.equal(rows[0].metadata.source,"offline");
    await f.record([{...f.gift,donor_id:rows[0].donor_id,donor_email:"",donor_name:"",method:"check"}]);
    assert.equal((await f.db.query("select count(*)::integer as count from public.giving_donors where church_id=$1",[f.church])).rows[0].count,1);
  } finally {await f.close();}
});

test("duplicate concurrent delivery of one batch records each gift once", options, async () => {
  const f = await fixture();
  const {Client} = await import("pg");
  const second = new Client({connectionString:url});
  await second.connect();
  try {
    const batch = randomUUID();
    const results = await Promise.all([
      f.record([f.gift,{...f.gift,amount_cents:29}],batch),
      second.query("select public.record_offline_gifts($1,$2,$3,$4::jsonb) as count",[f.church,f.actor,batch,JSON.stringify([f.gift,{...f.gift,amount_cents:29}])]),
    ]);
    assert.deepEqual(results.map(result => result.rows[0].count),[2,2]);
    const result = await f.db.query("select count(*)::integer as count,sum(amount_cents)::integer as total from public.giving_donations where church_id=$1",[f.church]);
    assert.deepEqual(result.rows[0],{count:2,total:1030});
  } finally {await second.end();await f.close();}
});

test("offline batches reject non-admins, other-church donors and funds, and roll back every row on failure", options, async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.record([f.gift],randomUUID(),f.viewer),/Church admin required/);
    const donor = randomUUID();
    await f.db.query("insert into public.giving_donors(id,church_id,email) values ($1,$2,'other@example.org')",[donor,f.otherChurch]);
    await assert.rejects(f.record([{...f.gift,donor_id:donor}]),/Donor not in church/);
    await assert.rejects(f.record([f.gift,{...f.gift,fund_id:f.otherFund}]),/Invalid offline gift/);
    await assert.rejects(f.record([f.gift,{...f.gift,amount_cents:0}]),/Invalid offline gift/);
    await assert.rejects(f.record([f.gift,{...f.gift,date:"not-a-date"}]),/invalid input syntax/);
    assert.equal((await f.db.query("select count(*)::integer as count from public.giving_donations where church_id=$1",[f.church])).rows[0].count,0);
    assert.equal((await f.db.query("select count(*)::integer as count from public.giving_donors where church_id=$1",[f.church])).rows[0].count,0);
  } finally {await f.close();}
});

test("only the server service role can invoke the offline write", options, async () => {
  const f = await fixture();
  try {
    const {rows} = await f.db.query("select has_function_privilege('anon','public.record_offline_gifts(uuid,uuid,uuid,jsonb)','EXECUTE') as anon,has_function_privilege('authenticated','public.record_offline_gifts(uuid,uuid,uuid,jsonb)','EXECUTE') as authenticated,has_function_privilege('service_role','public.record_offline_gifts(uuid,uuid,uuid,jsonb)','EXECUTE') as service");
    assert.deepEqual(rows[0],{anon:false,authenticated:false,service:true});
  } finally {await f.close();}
});
