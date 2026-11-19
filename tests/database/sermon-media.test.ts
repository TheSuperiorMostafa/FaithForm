import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Concurrency and versioning guarantees of 0170_sermon_media.sql.
 * Run with `pnpm test:sermon-media-database` (builds a disposable database).
 */
const DATABASE_URL = process.env.FAITHFORM_SERMON_MEDIA_DATABASE_URL;
const options = DATABASE_URL
  ? {}
  : { skip: "Run through scripts/run-sermon-media-database-tests.mjs against a disposable Postgres." };
if (/prod|supabase\.co/i.test(DATABASE_URL ?? "")) throw new Error("refusing a production-looking database");

type Row = Record<string, unknown>;
type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

async function church(client: Client, cap = 2): Promise<{ churchId: string; recordingId: string }> {
  const churchId = randomUUID();
  const recordingId = randomUUID();
  await client.query(`insert into public.churches (id, name) values ($1, 'Test church')`, [churchId]);
  await client.query(
    `insert into public.stream_recordings (id, church_id, storage_path, status) values ($1, $2, 'x', 'ready')`,
    [recordingId, churchId],
  );
  await client.query(
    `insert into public.sermon_media_settings (church_id, enabled, max_concurrent_jobs) values ($1, true, $2)`,
    [churchId, cap],
  );
  return { churchId, recordingId };
}

async function enqueue(client: Client, churchId: string, recordingId: string, key = `transcribe:${recordingId}`) {
  const { rows } = await client.query(
    `select * from public.enqueue_media_job($1, $2, 'transcribe', $2, $3)`,
    [churchId, recordingId, key],
  );
  return rows[0];
}

async function claim(client: Client, cap: number, now = "now()") {
  const { rows } = await client.query(
    `select * from public.claim_media_jobs('transcribe', $1, 100, 900, ${now})`,
    [cap],
  );
  return rows;
}

test("a repeated enqueue returns the live job instead of creating another", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    const { churchId, recordingId } = await church(client);
    const first = await enqueue(client, churchId, recordingId);
    const second = await enqueue(client, churchId, recordingId);
    assert.equal(first.id, second.id);
    const { rows } = await client.query(`select count(*)::int as n from public.media_jobs where recording_id = $1`, [recordingId]);
    assert.equal(rows[0].n, 1);
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("claims respect the global cap and each church's own cap", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    // Isolate from other rows in this disposable database.
    await client.query(`update public.media_jobs set status = 'cancelled' where status in ('queued','dispatched','running')`);
    const a = await church(client, 1);
    const b = await church(client, 2);
    for (let i = 0; i < 3; i += 1) {
      const rec = randomUUID();
      await client.query(`insert into public.stream_recordings (id, church_id, storage_path) values ($1, $2, 'x')`, [rec, a.churchId]);
      await enqueue(client, a.churchId, rec);
      const recB = randomUUID();
      await client.query(`insert into public.stream_recordings (id, church_id, storage_path) values ($1, $2, 'x')`, [recB, b.churchId]);
      await enqueue(client, b.churchId, recB);
    }
    const claimed = await claim(client, 10);
    const byChurch = (id: string) => claimed.filter((row) => row.church_id === id).length;
    assert.equal(byChurch(a.churchId), 1, "church A is capped at 1");
    assert.equal(byChurch(b.churchId), 2, "church B is capped at 2");
    assert.equal((await claim(client, 10)).length, 0, "nothing more until a running job finishes");

    // Global cap: with 3 dispatched, a cap of 3 leaves no room.
    await client.query(`update public.sermon_media_settings set max_concurrent_jobs = 10`);
    assert.equal((await claim(client, 3)).length, 0, "global cap reached");
    assert.equal((await claim(client, 4)).length, 1, "one slot under a cap of 4");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("a duplicate delivery cannot take over an attempt, and a stale worker cannot commit", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    await client.query(`update public.media_jobs set status = 'cancelled' where status in ('queued','dispatched','running')`);
    const { churchId, recordingId } = await church(client);
    const job = await enqueue(client, churchId, recordingId);
    const [claimed] = await claim(client, 10);
    assert.equal(claimed.id, job.id);
    const lease = claimed.lease_token as string;
    const attemptA = randomUUID();
    const attemptB = randomUUID();

    const touchA = await client.query(`select public.touch_media_job($1, $2, $3, 'transcribing', 0.1) as r`, [job.id, lease, attemptA]);
    assert.equal(touchA.rows[0].r, "ok");
    const touchB = await client.query(`select public.touch_media_job($1, $2, $3) as r`, [job.id, lease, attemptB]);
    assert.equal(touchB.rows[0].r, "stale", "the second delivery is refused");

    const staleCommit = await client.query(
      `select public.commit_machine_transcript($1, $2, $3, 'en', 'test', 10, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) as v`,
      [job.id, lease, attemptB],
    );
    assert.equal(staleCommit.rows[0].v, null);

    // Lease expires (worker restarted); the dispatcher re-issues it with a new token.
    await client.query(`update public.media_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [job.id]);
    await claim(client, 10);
    await client.query(`update public.media_jobs set next_attempt_at = now() - interval '1 second' where id = $1`, [job.id]);
    const [reclaimed] = await claim(client, 10);
    assert.equal(reclaimed.id, job.id);
    assert.notEqual(reclaimed.lease_token, lease);
    assert.equal(reclaimed.attempts, 2);

    const oldWorker = await client.query(
      `select public.commit_machine_transcript($1, $2, $3, 'en', 'test', 10, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) as v`,
      [job.id, lease, attemptA],
    );
    assert.equal(oldWorker.rows[0].v, null, "the restarted worker's old lease is dead");

    const attemptC = randomUUID();
    await client.query(`select public.touch_media_job($1, $2, $3)`, [job.id, reclaimed.lease_token, attemptC]);
    const ok = await client.query(
      `select public.commit_machine_transcript($1, $2, $3, 'en', 'test', 10, '[{"id":"s1","start":0,"end":5,"text":"hi"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) as v`,
      [job.id, reclaimed.lease_token, attemptC],
    );
    assert.equal(ok.rows[0].v, 1);
    const again = await client.query(
      `select public.commit_machine_transcript($1, $2, $3, 'en', 'test', 10, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) as v`,
      [job.id, reclaimed.lease_token, attemptC],
    );
    assert.equal(again.rows[0].v, null, "a retried commit after success writes nothing");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("expired leases fail once attempts are exhausted", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    await client.query(`update public.media_jobs set status = 'cancelled' where status in ('queued','dispatched','running')`);
    const { churchId, recordingId } = await church(client);
    const job = await enqueue(client, churchId, recordingId);
    await client.query(`update public.media_jobs set max_attempts = 1 where id = $1`, [job.id]);
    await claim(client, 10);
    await client.query(`update public.media_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [job.id]);
    await claim(client, 10);
    const { rows } = await client.query(`select status, last_error_code from public.media_jobs where id = $1`, [job.id]);
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].last_error_code, "lease_expired");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("moving the confirmed range versions the input and flags drafts built on the old one", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    const { churchId, recordingId } = await church(client);
    await client.query(
      `insert into public.recording_sermon_media (recording_id, church_id, current_transcript_version) values ($1, $2, 1)`,
      [recordingId, churchId],
    );
    const first = await client.query(`select public.confirm_sermon_range($1, $2, 600, 2400, null, 0) as v`, [recordingId, churchId]);
    assert.equal(first.rows[0].v, 1);

    const sermonId = randomUUID();
    await client.query(`insert into public.sermons (id, church_id) values ($1, $2)`, [sermonId, churchId]);
    await client.query(
      `insert into public.sermon_recording_sources (sermon_id, church_id, recording_id, input_version, transcript_version, range_start_sec, range_end_sec)
       values ($1, $2, $3, 1, 1, 600, 2400)`,
      [sermonId, churchId, recordingId],
    );
    const clip = await client.query(
      `insert into public.sermon_clips (church_id, recording_id, input_version, origin, start_sec, end_sec)
       values ($1, $2, 1, 'suggested', 700, 760) returning id`,
      [churchId, recordingId],
    );

    const stale = await client.query(`select public.confirm_sermon_range($1, $2, 610, 2400, null, 0) as v`, [recordingId, churchId]);
    assert.equal(stale.rows[0].v, null, "a stale editor cannot overwrite");

    const same = await client.query(`select public.confirm_sermon_range($1, $2, 600, 2400, null, 1) as v`, [recordingId, churchId]);
    assert.equal(same.rows[0].v, 1, "re-confirming the same range is not new input");

    const moved = await client.query(`select public.confirm_sermon_range($1, $2, 610, 2400, null, 1) as v`, [recordingId, churchId]);
    assert.equal(moved.rows[0].v, 2);
    const lesson = await client.query(`select needs_review from public.sermon_recording_sources where sermon_id = $1`, [sermonId]);
    assert.equal(lesson.rows[0].needs_review, true);
    const clipRow = await client.query(`select needs_review from public.sermon_clips where id = $1`, [clip.rows[0].id]);
    assert.equal(clipRow.rows[0].needs_review, true);
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("transcript edits are versioned and only edits inside the sermon flag drafts", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    const { churchId, recordingId } = await church(client);
    await client.query(
      `insert into public.recording_transcripts (church_id, recording_id, version, kind, segments) values ($1, $2, 1, 'machine', '[]'::jsonb)`,
      [churchId, recordingId],
    );
    await client.query(
      `insert into public.recording_sermon_media (recording_id, church_id, current_transcript_version) values ($1, $2, 1)`,
      [recordingId, churchId],
    );
    await client.query(`select public.confirm_sermon_range($1, $2, 600, 2400, null, 0)`, [recordingId, churchId]);

    const outside = await client.query(
      `select public.save_transcript_edit($1, $2, 1, '[]'::jsonb, 10, 20, null) as v`,
      [recordingId, churchId],
    );
    assert.equal(outside.rows[0].v, 2);
    let state = await client.query(`select input_version from public.recording_sermon_media where recording_id = $1`, [recordingId]);
    assert.equal(state.rows[0].input_version, 1, "an edit in the worship set is not sermon input");

    const stale = await client.query(`select public.save_transcript_edit($1, $2, 1, '[]'::jsonb, 700, 710, null) as v`, [recordingId, churchId]);
    assert.equal(stale.rows[0].v, null, "an editor working from version 1 must reload");

    const inside = await client.query(`select public.save_transcript_edit($1, $2, 2, '[]'::jsonb, 700, 710, null) as v`, [recordingId, churchId]);
    assert.equal(inside.rows[0].v, 3);
    state = await client.query(`select input_version from public.recording_sermon_media where recording_id = $1`, [recordingId]);
    assert.equal(state.rows[0].input_version, 2);
    const machine = await client.query(`select kind from public.recording_transcripts where recording_id = $1 and version = 1`, [recordingId]);
    assert.equal(machine.rows[0].kind, "machine", "the machine version is kept");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("a render posts to a Page once unless the earlier post definitively failed", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    const { churchId, recordingId } = await church(client);
    const clip = await client.query(
      `insert into public.sermon_clips (church_id, recording_id, input_version, origin, start_sec, end_sec)
       values ($1, $2, 1, 'manual', 10, 40) returning id`,
      [churchId, recordingId],
    );
    const render = await client.query(
      `insert into public.sermon_clip_renders (church_id, clip_id, edit_version, spec_hash, spec, status)
       values ($1, $2, 1, $3, '{}'::jsonb, 'ready') returning id`,
      [churchId, clip.rows[0].id, "a".repeat(64)],
    );
    const user = randomUUID();
    const insert = () =>
      client.query(
        `insert into public.facebook_reel_posts (church_id, clip_id, render_id, page_id, approved_by, approved_at, posted_by)
         values ($1, $2, $3, '123', $4, now(), $4)
         on conflict (render_id, page_id) where status <> 'failed' do nothing returning id`,
        [churchId, clip.rows[0].id, render.rows[0].id, user],
      );
    assert.equal((await insert()).rowCount, 1);
    assert.equal((await insert()).rowCount, 0, "the double-click lands on the existing post");
    await client.query(`update public.facebook_reel_posts set status = 'needs_check' where render_id = $1`, [render.rows[0].id]);
    assert.equal((await insert()).rowCount, 0, "an ambiguous post is reconciled, not re-sent");
    await client.query(`update public.facebook_reel_posts set status = 'failed' where render_id = $1`, [render.rows[0].id]);
    assert.equal((await insert()).rowCount, 1, "after a definite failure a new post may start");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});

test("a clip can't be approved without naming the video, the approver and the Page", options, async () => {
  const client = await connect();
  try {
    await client.query("begin");
    const { churchId, recordingId } = await church(client);
    const clip = await client.query(
      `insert into public.sermon_clips (church_id, recording_id, input_version, origin, start_sec, end_sec)
       values ($1, $2, 1, 'suggested', 10, 40) returning id, approval_status`,
      [churchId, recordingId],
    );
    assert.equal(clip.rows[0].approval_status, "pending");
    await client.query("savepoint s");
    await assert.rejects(
      client.query(`update public.sermon_clips set approval_status = 'approved' where id = $1`, [clip.rows[0].id]),
      /sermon_clips_approval_complete/,
    );
    await client.query("rollback to savepoint s");
    const render = await client.query(
      `insert into public.sermon_clip_renders (church_id, clip_id, edit_version, spec_hash, spec, status)
       values ($1, $2, 1, $3, '{}'::jsonb, 'ready') returning id`,
      [churchId, clip.rows[0].id, "b".repeat(64)],
    );
    await client.query(
      `update public.sermon_clips set approval_status = 'approved', approved_render_id = $2, approved_by = $3, approved_page_id = '123', scheduled_for = now()
       where id = $1`,
      [clip.rows[0].id, render.rows[0].id, randomUUID()],
    );
    const settings = await client.query(`select clips_per_service, auto_clips, post_schedule->>'time' as t from public.sermon_media_settings where church_id = $1`, [churchId]);
    assert.equal(settings.rows[0].clips_per_service, 3);
    assert.equal(settings.rows[0].auto_clips, true);
    assert.equal(settings.rows[0].t, "12:00");
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
