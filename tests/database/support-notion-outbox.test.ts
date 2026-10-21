import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { connect, suiteOptions } from "./groups-fixtures";

test("Notion queue has RLS and is accessible only to service workers", suiteOptions, async () => {
  const client = await connect();
  try {
    const { rows: [row] } = await client.query(`select
      (select relrowsecurity from pg_class where oid = 'public.support_notion_outbox'::regclass) as rls,
      has_table_privilege('authenticated', 'public.support_notion_outbox', 'SELECT') as customer_read,
      has_table_privilege('anon', 'public.support_notion_outbox', 'INSERT') as anon_write,
      has_function_privilege('authenticated', 'public.claim_support_notion_ticket(uuid)', 'EXECUTE') as customer_claim,
      has_function_privilege('anon', 'public.enqueue_support_notion_ticket()', 'EXECUTE') as anon_enqueue,
      has_table_privilege('service_role', 'public.support_notion_outbox', 'UPDATE') as worker_write`);
    assert.deepEqual(row, { rls: true, customer_read: false, anon_write: false, customer_claim: false, anon_enqueue: false, worker_write: true });
  } finally { await client.end(); }
});

test("service-created tickets queue atomically and deleting a ticket removes its job", suiteOptions, async () => {
  const client = await connect();
  const id = randomUUID();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query("insert into public.support_tickets(id, subject) values ($1, 'Synthetic queue check')", [id]);
    const { rows: [job] } = await client.query("select attempts, delivered_at from public.support_notion_outbox where ticket_id = $1", [id]);
    assert.equal(job.attempts, 0);
    assert.equal(job.delivered_at, null);
    await client.query("delete from public.support_tickets where id = $1", [id]);
    const remaining = await client.query("select ticket_id from public.support_notion_outbox where ticket_id = $1", [id]);
    assert.equal(remaining.rowCount, 0);
  } finally { await client.query("rollback"); await client.end(); }
});

test("concurrent workers cannot claim the same ticket and expired leases recover", suiteOptions, async () => {
  const first = await connect();
  const second = await connect();
  const id = randomUUID();
  try {
    await first.query("insert into public.support_tickets(id, subject) values ($1, 'Synthetic lease check')", [id]);
    await first.query("begin");
    await first.query("set local role service_role");
    const { rows: [initial] } = await first.query("select * from public.claim_support_notion_ticket($1)", [id]);
    assert.equal(initial.attempts, 1);
    const locked = await second.query("select * from public.claim_support_notion_ticket($1)", [id]);
    assert.equal(locked.rowCount, 0, "locked row must be skipped without waiting");
    await first.query("commit");
    const leased = await second.query("select * from public.claim_support_notion_ticket($1)", [id]);
    assert.equal(leased.rowCount, 0);
    await second.query("update public.support_notion_outbox set lease_until = now() - interval '1 second' where ticket_id = $1", [id]);
    const { rows: [recovered] } = await second.query("select * from public.claim_support_notion_ticket($1)", [id]);
    assert.equal(recovered.attempts, 2);
    assert.notEqual(recovered.lease_token, initial.lease_token);
    const stale = await second.query("update public.support_notion_outbox set delivered_at = now() where ticket_id = $1 and lease_token = $2", [id, initial.lease_token]);
    assert.equal(stale.rowCount, 0);
  } finally {
    await first.query("rollback");
    await first.query("reset role");
    await first.query("delete from public.support_tickets where id = $1", [id]);
    await first.end(); await second.end();
  }
});

test("future retries and delivered tickets cannot be reclaimed", suiteOptions, async () => {
  const client = await connect();
  const id = randomUUID();
  try {
    await client.query("begin");
    await client.query("insert into public.support_tickets(id, subject) values ($1, 'Synthetic retry check')", [id]);
    await client.query("update public.support_notion_outbox set available_at = now() + interval '1 hour' where ticket_id = $1", [id]);
    const future = await client.query("select * from public.claim_support_notion_ticket($1)", [id]);
    assert.equal(future.rowCount, 0);
    await client.query("update public.support_notion_outbox set available_at = now(), delivered_at = now() where ticket_id = $1", [id]);
    const sent = await client.query("select * from public.claim_support_notion_ticket($1)", [id]);
    assert.equal(sent.rowCount, 0);
  } finally { await client.query("rollback"); await client.end(); }
});
