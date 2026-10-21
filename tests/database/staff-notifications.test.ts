import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connect } from "./groups-fixtures";

const enabled = process.env.FAITHFORM_TEST_DATABASE_URL && (process.env.FAITHFORM_FULL_SCHEMA === "1" || process.env.FAITHFORM_NOTIFICATION_SCHEMA === "1");
const options = enabled ? {} : { skip: "Needs an explicitly selected disposable notification-schema database." };

test("staff preferences are private to their church user; jobs and customer health are service-only", options, async () => {
  const client = await connect();
  const user = randomUUID(), other = randomUUID(), church = randomUUID(), otherChurch = randomUUID();
  try {
    await client.query("begin");
    await client.query("insert into auth.users(id, email) values ($1, 'one@example.test'), ($2, 'two@example.test')", [user, other]);
    await client.query("insert into public.churches(id, name, slug) values ($1,'One',$1::uuid::text),($2,'Two',$2::uuid::text)", [church, otherChurch]);
    await client.query("insert into public.church_users(church_id,user_id,role) values ($1,$2,'admin'),($1,$3,'viewer'),($4,$2,'admin')", [church, user, other, otherChurch]);
    await client.query("insert into public.staff_notification_preferences(church_id,user_id) values ($1,$2),($1,$3),($4,$2)", [church, user, other, otherChurch]);
    const { rows: [privileges] } = await client.query(`select
      has_table_privilege('authenticated','public.staff_notification_preferences','UPDATE') as customer_write,
      has_table_privilege('authenticated','public.staff_notification_jobs','SELECT') as customer_jobs,
      has_table_privilege('authenticated','public.church_health_reviews','SELECT') as customer_health,
      has_function_privilege('anon','public.claim_staff_notification_jobs(integer)','EXECUTE') as anonymous_claim,
      has_function_privilege('authenticated','public.admin_church_health_signals()','EXECUTE') as customer_signals`);
    assert.deepEqual(privileges, { customer_write: false, customer_jobs: false, customer_health: false, anonymous_claim: false, customer_signals: false });
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await client.query("set local role authenticated");
    assert.equal((await client.query("select * from public.staff_notification_preferences")).rowCount, 2);
    await client.query("reset role");
    await client.query("delete from public.church_users where church_id=$1 and user_id=$2", [otherChurch, user]);
    await client.query("set local role authenticated");
    const { rows } = await client.query("select church_id,user_id from public.staff_notification_preferences");
    assert.deepEqual(rows, [{ church_id: church, user_id: user }]);
  } finally { await client.query("rollback"); await client.end(); }
});

test("notification claims skip locked jobs and recover only idempotent email leases", options, async () => {
  const first = await connect(), second = await connect();
  const user = randomUUID(), church = randomUUID();
  try {
    await first.query("insert into auth.users(id,email) values ($1,'queue@example.test')", [user]);
    await first.query("insert into public.churches(id,name,slug) values ($1,'Queue',$1::uuid::text)", [church]);
    await first.query("insert into public.staff_notification_jobs(church_id,user_id,event,event_key,channel,href) values ($1,$2,'attendance_completed','test','email','/dashboard/attendance'),($1,$2,'attendance_completed','test','phone','/dashboard/attendance')", [church,user]);
    await first.query("begin");
    await first.query("set local role service_role");
    assert.equal((await first.query("select * from public.claim_staff_notification_jobs(10)")).rowCount, 2);
    assert.equal((await second.query("select * from public.claim_staff_notification_jobs(10)")).rowCount, 0);
    await first.query("commit");
    await first.query("update public.staff_notification_jobs set updated_at=now()-interval '6 minutes' where church_id=$1", [church]);
    const { rows } = await second.query("select * from public.claim_staff_notification_jobs(10)");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].channel, "email");
    assert.equal(rows[0].attempts, 2);
  } finally {
    await first.query("rollback");
    await first.query("reset role");
    await first.query("delete from public.churches where id=$1", [church]);
    await first.query("delete from auth.users where id=$1", [user]);
    await first.end(); await second.end();
  }
});

test("church health counts distinct active days and support independently", options, async () => {
  const client = await connect();
  const church = randomUUID(), user = randomUUID();
  try {
    await client.query("begin");
    await client.query("insert into auth.users(id,email) values ($1,'health@example.test')", [user]);
    await client.query("insert into public.churches(id,name,slug) values ($1,'Health',$1::uuid::text)", [church]);
    await client.query("insert into public.dashboard_usage_daily(church_id,user_id,usage_date,active_seconds) values ($1,$2,current_date,60),($1,$2,current_date-1,60),($1,$2,current_date-8,60),($1,$2,current_date-2,0)", [church,user]);
    await client.query("insert into public.support_tickets(church_id,subject,status) values ($1,'Synthetic health issue','open')", [church]);
    const { rows: [row] } = await client.query("select * from public.admin_church_health_signals() where church_id=$1", [church]);
    assert.equal(Number(row.recent_days), 2);
    assert.equal(Number(row.previous_days), 1);
    assert.equal(Number(row.open_tickets), 1);
  } finally { await client.query("rollback"); await client.end(); }
});
