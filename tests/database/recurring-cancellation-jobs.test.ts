import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connect, suiteOptions } from "./groups-fixtures";

test("cancellation jobs survive account deletion and are restricted to the server", suiteOptions, async () => {
  const client = await connect();
  const user = randomUUID();
  const account = randomUUID();
  const job = randomUUID();
  try {
    await client.query("begin");
    await client.query("insert into auth.users (id, email) values ($1, $2)", [user, `${user}@example.invalid`]);
    await client.query("insert into public.visitor_accounts (id, user_id) values ($1, $2)", [account, user]);
    await client.query("set local role service_role");
    await client.query("insert into public.giving_recurring_cancellation_jobs (id, stripe_account_id, stripe_subscription_id) values ($1, 'acct_test', 'sub_test')", [job]);
    await client.query("reset role");
    await client.query("delete from auth.users where id = $1", [user]);
    assert.equal((await client.query("select id from public.visitor_accounts where id = $1", [account])).rowCount, 0);
    assert.equal((await client.query("select id from public.giving_recurring_cancellation_jobs where id = $1", [job])).rowCount, 1);
    for (const role of ["anon", "authenticated"]) {
      const grants = await client.query(`select has_table_privilege($1, 'public.giving_recurring_cancellation_jobs', 'SELECT') as readable,
        has_function_privilege($1, 'public.claim_recurring_gift_cancellations(uuid,integer)', 'EXECUTE') as executable`, [role]);
      assert.equal(grants.rows[0].readable, false);
      assert.equal(grants.rows[0].executable, false);
    }
  } finally { await client.query("rollback"); await client.end(); }
});

test("concurrent cancellation workers claim separate jobs and expired leases can recover", suiteOptions, async () => {
  const a = await connect();
  const b = await connect();
  const account = `acct_${randomUUID().replaceAll("-", "")}`;
  const firstToken = randomUUID();
  const secondToken = randomUUID();
  try {
    for (let i = 0; i < 4; i++) await a.query("insert into public.giving_recurring_cancellation_jobs (stripe_account_id, stripe_subscription_id) values ($1,$2)", [account, `sub_test${i}`]);
    await a.query("begin");
    const first = await a.query("select * from public.claim_recurring_gift_cancellations($1,2)", [firstToken]);
    await b.query("begin");
    const second = await b.query("select * from public.claim_recurring_gift_cancellations($1,2)", [secondToken]);
    assert.equal(first.rowCount, 2);
    assert.equal(second.rowCount, 2);
    assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 4);
    await a.query("commit");
    await b.query("commit");
    assert.equal((await a.query("select * from public.claim_recurring_gift_cancellations($1,100)", [randomUUID()])).rowCount, 0);
    const id = first.rows[0].id;
    await a.query("update public.giving_recurring_cancellation_jobs set lease_expires_at = now() - interval '1 minute' where id=$1", [id]);
    const reclaimed = await b.query("select * from public.claim_recurring_gift_cancellations($1,1)", [randomUUID()]);
    assert.equal(reclaimed.rows[0].id, id);
    assert.equal(reclaimed.rows[0].attempts, 2);
    assert.equal((await a.query("update public.giving_recurring_cancellation_jobs set status='completed' where id=$1 and lease_token=$2", [id, firstToken])).rowCount, 0);
    assert.equal((await a.query("select * from public.claim_recurring_gift_cancellations(null,100)")).rowCount, 0);
  } finally {
    await a.query("rollback"); await b.query("rollback");
    await a.query("delete from public.giving_recurring_cancellation_jobs where stripe_account_id=$1", [account]);
    await a.end(); await b.end();
  }
});
