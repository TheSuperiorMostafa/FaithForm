import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connect, suiteOptions, type Client } from "./groups-fixtures";

const fingerprint = "a".repeat(64);
const changedFingerprint = "b".repeat(64);
const payload = { test: false, checkedAt: "2026-10-03T12:00:00.000Z",
  checks: [{ name: "payment_events_terminal", count: 3 }] };

async function claim(client: Client, key: string, token: string, fp: string | null = fingerprint,
  snapshot = payload, repeat = false) {
  return client.query("select * from public.claim_operations_alert($1,$2,$3::jsonb,$4,$5)",
    [key, fp, JSON.stringify(snapshot), token, repeat]);
}
async function complete(client: Client, key: string, token: string, sent: boolean) {
  const result = await client.query("select public.complete_operations_alert($1,$2,$3) as completed", [key, token, sent]);
  return result.rows[0].completed;
}

test("operations alert state and claim/completion are inaccessible to church clients", suiteOptions, async () => {
  const client = await connect();
  try {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await client.query(`select
        has_table_privilege($1,'public.operations_alert_state','SELECT') as readable,
        has_function_privilege($1,'public.claim_operations_alert(text,text,jsonb,uuid,boolean)','EXECUTE') as claimable,
        has_function_privilege($1,'public.complete_operations_alert(text,uuid,boolean)','EXECUTE') as completable`, [role]);
      assert.deepEqual(rows[0], { readable: false, claimable: false, completable: false });
    }
  } finally { await client.end(); }
});

test("operations failures retry an immutable delivery snapshot, suppress repeats, and recover quietly", suiteOptions, async () => {
  const client = await connect();
  const key = `operations-test-${randomUUID()}`;
  try {
    const token = randomUUID();
    const first = (await claim(client, key, token)).rows[0];
    assert.ok(first.delivery_key);
    assert.deepEqual(first.alert_payload, payload);
    assert.equal(await complete(client, key, randomUUID(), true), false, "wrong claim token must not complete");
    assert.equal(await complete(client, key, token, false), true);
    assert.equal((await claim(client, key, randomUUID())).rowCount, 0, "failed sends back off");
    await client.query("update public.operations_alert_state set next_attempt_at=now()-interval '1 second' where monitor_key=$1", [key]);
    const retryToken = randomUUID();
    const changedCounts = { ...payload, checks: [{ name: "payment_events_terminal", count: 77 }] };
    const retry = (await claim(client, key, retryToken, fingerprint, changedCounts)).rows[0];
    assert.equal(retry.delivery_key, first.delivery_key);
    assert.deepEqual(retry.alert_payload, payload, "provider retries must use the exact original body");
    assert.equal(await complete(client, key, retryToken, true), true);
    assert.equal((await claim(client, key, randomUUID())).rowCount, 0, "unchanged incidents stay quiet");
    assert.equal((await claim(client, key, randomUUID(), changedFingerprint, changedCounts)).rowCount, 0, "changed incidents honor cooldown");
    await client.query("update public.operations_alert_state set last_sent_at=now()-interval '61 minutes' where monitor_key=$1", [key]);
    const changedToken = randomUUID();
    const changed = (await claim(client, key, changedToken, changedFingerprint, changedCounts)).rows[0];
    assert.notEqual(changed.delivery_key, first.delivery_key);
    assert.deepEqual(changed.alert_payload, changedCounts);
    assert.equal(await complete(client, key, changedToken, true), true);
    assert.equal((await claim(client, key, randomUUID(), null)).rowCount, 0);
    const recovery = await client.query("select incident_fingerprint,alert_payload,delivery_key,last_sent_at from public.operations_alert_state where monitor_key=$1", [key]);
    assert.deepEqual(recovery.rows[0], { incident_fingerprint: null, alert_payload: null, delivery_key: null, last_sent_at: null });
    assert.equal((await claim(client, key, randomUUID())).rowCount, 1, "a resolved incident may notify on recurrence");
  } finally {
    await client.query("delete from public.operations_alert_state where monitor_key=$1", [key]);
    await client.end();
  }
});

test("operations claims exclude overlapping workers, reject expired completion and allow test cooldown repeats", suiteOptions, async () => {
  const a = await connect();
  const b = await connect();
  const key = `operations-concurrent-${randomUUID()}`;
  try {
    await a.query("insert into public.operations_alert_state(monitor_key) values($1)", [key]);
    await a.query("begin");
    const oldToken = randomUUID();
    const first = await claim(a, key, oldToken);
    assert.equal(first.rowCount, 1);
    await b.query("set statement_timeout='2s'");
    assert.equal((await claim(b, key, randomUUID())).rowCount, 0, "locked claims skip rather than duplicate");
    await a.query("commit");
    assert.equal((await claim(b, key, randomUUID())).rowCount, 0, "a live lease excludes later workers");
    await a.query("update public.operations_alert_state set lease_expires_at=now()-interval '1 second' where monitor_key=$1", [key]);
    assert.equal(await complete(a, key, oldToken, true), false);
    const newToken = randomUUID();
    const retry = await claim(b, key, newToken);
    assert.equal(retry.rows[0].delivery_key, first.rows[0].delivery_key);
    assert.equal(await complete(a, key, oldToken, true), false);
    assert.equal(await complete(b, key, newToken, true), true);
    assert.equal((await claim(a, key, randomUUID(), fingerprint, payload, true)).rowCount, 0, "test sends share the cooldown");
    await a.query("update public.operations_alert_state set last_sent_at=now()-interval '61 minutes' where monitor_key=$1", [key]);
    const repeated = await claim(a, key, randomUUID(), fingerprint, payload, true);
    assert.equal(repeated.rowCount, 1);
    assert.notEqual(repeated.rows[0].delivery_key, retry.rows[0].delivery_key);
  } finally {
    await a.query("rollback");
    await a.query("delete from public.operations_alert_state where monitor_key=$1", [key]);
    await a.end(); await b.end();
  }
});
