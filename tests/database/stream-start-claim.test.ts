import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connect, suiteOptions, withChurch } from "./groups-fixtures";

test("concurrent starts atomically reserve one active church session and preserve interrupted claims", suiteOptions, async () => {
  await withChurch(async (first, church) => {
    const second = await connect();
    const firstId = randomUUID();
    const secondId = randomUUID();
    try {
      await first.query("begin");
      await first.query("set local role service_role");
      await first.query("insert into public.stream_sessions (id,church_id,status) values ($1,$2,'preparing')", [firstId, church.id]);
      // The second insert waits on the winner's unique-index entry. Attach the
      // rejection handler before releasing that entry to avoid a racing rejection.
      const contender = assert.rejects(
        second.query("insert into public.stream_sessions (id,church_id,status) values ($1,$2,'preparing')", [secondId, church.id]),
        (error: unknown) => (error as { code: string }).code === "23505",
      );
      await first.query("commit");
      await contender;
      assert.equal((await first.query("select id from public.stream_sessions where church_id=$1 and status='preparing'", [church.id])).rowCount, 1);
      // An uncertain external setup remains reserved; it is not automatically
      // released/re-provisioned merely because the originating request ended.
      await first.query("update public.stream_sessions set error_message='Setup needs review' where id=$1", [firstId]);
      await assert.rejects(second.query("insert into public.stream_sessions (id,church_id,status) values ($1,$2,'preparing')", [secondId, church.id]),
        (error: unknown) => (error as { code: string }).code === "23505");
      // The existing explicit End operation is the recovery boundary.
      await first.query("update public.stream_sessions set status='ended',ended_at=now() where id=$1", [firstId]);
      await second.query("insert into public.stream_sessions (id,church_id,status) values ($1,$2,'preparing')", [secondId, church.id]);
      assert.equal((await second.query("select id from public.stream_sessions where church_id=$1 and status='preparing'", [church.id])).rows[0].id, secondId);
    } finally {
      await first.query("rollback");
      await second.end();
    }
  });
});

test("simulated handoff URLs are server-only, separate from artwork, and acknowledgements persist", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const event = randomUUID();
    await client.query("insert into public.stream_events (id,church_id,title,starts_at,status,simulated,simulated_source_path,artwork_url) values ($1,$2,'Simulated',now(),'live',true,'church/video.mp4','https://public.invalid/artwork')", [event, church.id]);
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      await client.query("insert into public.stream_simulated_playout_handoffs (event_id,church_id,source_url,prepared_at) values ($1,$2,'https://signed.invalid/video',now())", [event, church.id]);
      await client.query("update public.stream_simulated_playout_handoffs set source_url=null,completed_at=now() where event_id=$1", [event]);
      await client.query("commit");
      assert.equal((await client.query("select artwork_url from public.stream_events where id=$1", [event])).rows[0].artwork_url, "https://public.invalid/artwork");
      const handoff = (await client.query("select source_url,completed_at from public.stream_simulated_playout_handoffs where event_id=$1", [event])).rows[0];
      assert.equal(handoff.source_url, null);
      assert.ok(handoff.completed_at);
      for (const role of ["anon", "authenticated"]) {
        const grants = await client.query("select has_table_privilege($1,'public.stream_simulated_playout_handoffs','SELECT') as readable,has_table_privilege($1,'public.stream_simulated_playout_handoffs','INSERT') as writable", [role]);
        assert.equal(grants.rows[0].readable, false);
        assert.equal(grants.rows[0].writable, false);
      }
      await assert.rejects(client.query("update public.stream_simulated_playout_handoffs set church_id=gen_random_uuid() where event_id=$1", [event]),
        (error: unknown) => (error as { code: string }).code === "23503");
    } finally {
      await client.query("rollback");
    }
  });
});
