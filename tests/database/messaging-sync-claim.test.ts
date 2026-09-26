import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { connect, suiteOptions } from "./groups-fixtures";

/**
 * Two runs of the same group's member sync at once let a stale snapshot write
 * last and re-add someone a leader had just removed (0109). A job waits while
 * its subject has a run holding a live lease, and goes once that run is done.
 */
test("a subject's second job waits for the run in progress", suiteOptions, async () => {
  const client = await connect();
  const key = `group.members:${randomUUID()}`;
  try {
    await client.query("begin");
    await client.query(
      `insert into public.messaging_sync_jobs (kind, subject, dedupe_key, status, lease_token, lease_expires_at, next_attempt_at)
       values ('group.members', $1, $1, 'running', 'first', now() + interval '2 minutes', now())`,
      [key],
    );
    await client.query(
      `insert into public.messaging_sync_jobs (kind, subject, dedupe_key, status, next_attempt_at)
       values ('group.members', $1, $1, 'pending', now())`,
      [key],
    );

    const blocked = await client.query(
      `select id from public.claim_messaging_sync_jobs('second', 25, 120, now(), array[$1])`,
      [key],
    );
    assert.equal(blocked.rowCount, 0, "claimed while another run of the same subject held its lease");

    await client.query(
      `update public.messaging_sync_jobs set status = 'done', lease_token = null, lease_expires_at = null
        where dedupe_key = $1 and status = 'running'`,
      [key],
    );
    const next = await client.query(
      `select status from public.claim_messaging_sync_jobs('second', 25, 120, now(), array[$1])`,
      [key],
    );
    assert.equal(next.rowCount, 1, "the waiting job runs once the first is done");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
