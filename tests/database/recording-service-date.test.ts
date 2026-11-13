import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Requires the complete migration chain, including 0165, on a deliberately
// selected disposable database. Never infer a target from application secrets.
const databaseUrl = process.env.FAITHFORM_TEST_DATABASE_URL;
if (/prod/i.test(databaseUrl ?? "")) throw new Error("Refusing a production-looking recording date test target.");

test("service dates reach the canonical website and app projections without changing recorder evidence", {
  skip: !databaseUrl || process.env.FAITHFORM_FULL_SCHEMA !== "1"
    ? "Select FAITHFORM_TEST_DATABASE_URL and FAITHFORM_FULL_SCHEMA=1 after applying all migrations to a disposable database."
    : false,
}, async t => {
  const { Client } = await import("pg");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const church = randomUUID(), other = randomUUID(), series = randomUUID();
  const recording = randomUUID(), second = randomUUID(), foreign = randomUUID();
  const slug = `date-${church.slice(0, 8)}`, otherSlug = `date-${other.slice(0, 8)}`;
  const originalStart = "2026-11-13T03:11:00.000Z", originalCreated = "2026-11-13T03:12:00.000Z";
  const iso = (value: unknown) => new Date(value as string | Date).toISOString();
  const read = async (relation: string | null = "joined") => {
    const [archive, detail, items, web] = await Promise.all([
      db.query("select * from public.mobile_media_archive($1,$2)", [slug, relation]),
      db.query("select * from public.mobile_media_detail($1,$2,$3)", [slug, relation, recording]),
      db.query("select * from public.mobile_media_series_items($1,$2,'qa-series')", [slug, relation]),
      db.query("select * from public.web_recordings($1,$2)", [slug, recording]),
    ]);
    return [archive.rows.find(row => row.id === recording), detail.rows[0], items.rows.find(row => row.id === recording), web.rows[0]];
  };
  const update = async (patch: string, values: unknown[] = []) => db.query(`update public.stream_recordings set ${patch} where id=$1`, [recording, ...values]);
  try {
    await db.query("begin");
    await db.query("insert into public.churches(id,name,slug,timezone) values($1,'QA Date Church',$2,'America/New_York'),($3,'Other QA Date Church',$4,'Asia/Tokyo')", [church, slug, other, otherSlug]);
    await db.query("insert into public.media_series(id,church_id,name,slug) values($1,$2,'QA Series','qa-series')", [series, church]);
    for (const [id, owner, collection, published] of [[recording, church, series, "2026-11-13T05:00:00Z"], [second, church, series, "2026-10-01T05:00:00Z"], [foreign, other, null, "2026-11-14T05:00:00Z"]]) {
      await db.query(`insert into public.stream_recordings
        (id,church_id,series_id,title,storage_path,status,source_kind,duration_sec,created_at,recording_started_at,
         recording_ended_at,processing_started_at,ready_at,mobile_visibility,mobile_published_at,web_published_at)
        values($1::uuid,$2,$3,'QA Service','qa/' || ($1::uuid)::text || '.mp4','ready','file',60,$4,$5,
          '2026-11-13T03:12:00Z','2026-11-13T03:12:01Z','2026-11-13T03:12:02Z','public',$6,$6)`,
      [id, owner, collection, originalCreated, originalStart, published]);
      // Use the actual verifier to satisfy the stored object-identity contract.
      await db.query(`select * from public.record_recording_rendition(
        $1,$2,true,'progressive','ok','isom','avc1','mp4a','avc1.4d401f','mp4a.40.2',48000,2::smallint,
        1024::bigint,'"qa-etag"',null,$3)`, [id, owner, "a".repeat(64)]);
    }

    await t.test("null overrides preserve the actual start time, then creation fallback, in all four projections", async () => {
      for (const row of await read()) assert.equal(iso(row?.recorded_at), originalStart);
      await update("recording_started_at=null");
      for (const row of await read()) assert.equal(iso(row?.recorded_at), originalCreated);
      await update("recording_started_at=$2", [originalStart]);
    });

    await t.test("a chosen day is church-local noon across DST, leap days and distant time zones", async () => {
      const evidence = (await db.query("select created_at,recording_started_at,recording_ended_at,processing_started_at,ready_at from public.stream_recordings where id=$1", [recording])).rows[0];
      for (const [zone, day, expected] of [
        ["America/New_York", "2026-03-08", "2026-03-08T16:00:00.000Z"],
        ["America/New_York", "2026-11-01", "2026-11-01T17:00:00.000Z"],
        ["America/New_York", "2024-02-29", "2024-02-29T17:00:00.000Z"],
        ["Asia/Tokyo", "2026-01-04", "2026-01-04T03:00:00.000Z"],
        ["Pacific/Kiritimati", "2026-01-04", "2026-01-03T22:00:00.000Z"],
      ]) {
        await db.query("update public.churches set timezone=$2 where id=$1", [church, zone]);
        await update("service_date=$2", [day]);
        for (const row of await read()) assert.equal(iso(row?.recorded_at), expected, `${zone}: ${day}`);
      }
      assert.deepEqual((await db.query("select created_at,recording_started_at,recording_ended_at,processing_started_at,ready_at from public.stream_recordings where id=$1", [recording])).rows[0], evidence);
      await db.query("update public.churches set timezone='America/New_York' where id=$1", [church]);
      await update("service_date=null");
      for (const row of await read()) assert.equal(iso(row?.recorded_at), originalStart);
    });

    await t.test("date-only changes invalidate app versions; re-saving the same date does not", async () => {
      const version = async () => (await db.query("select mobile_publication_version from public.stream_recordings where id=$1", [recording])).rows[0].mobile_publication_version as number;
      const before = await version();
      await update("service_date='2026-01-04'");
      assert.equal(await version(), before + 1);
      await update("service_date='2026-01-04'");
      assert.equal(await version(), before + 1);
      await update("service_date=null");
      assert.equal(await version(), before + 2);
    });

    await t.test("website limits and series order use the chosen day while archive pagination retains its publication cursor", async () => {
      await update("service_date='2026-01-04'");
      await db.query("update public.stream_recordings set service_date='2026-10-11' where id=$1", [second]);
      assert.equal((await db.query("select id from public.web_recordings($1,null,1)", [slug])).rows[0].id, second);
      assert.deepEqual((await db.query("select id from public.mobile_media_series_items($1,'joined','qa-series')", [slug])).rows.map(row => row.id), [recording, second]);
      const first = (await db.query("select * from public.mobile_media_archive($1,'joined',null,null,null,1)", [slug])).rows[0];
      assert.equal(first.id, recording);
      const next = await db.query("select * from public.mobile_media_archive($1,'joined',null,$2,$3,1)", [slug, first.cursor_published, first.cursor_id]);
      assert.equal(next.rows[0].id, second);
    });

    await t.test("date edits cannot make drafts, unverified, deleted or other churches' recordings visible", async () => {
      assert.equal((await db.query("select * from public.web_recordings($1,$2)", [otherSlug, recording])).rows.length, 0);
      assert.equal((await db.query("select * from public.mobile_media_detail($1,'joined',$2)", [otherSlug, recording])).rows.length, 0);
      for (const patch of ["status='processing'", "deleted_at=now()", "mobile_playable=false"]) {
        await db.query("savepoint hidden_recording");
        await update(patch);
        for (const row of await read()) assert.equal(row, undefined, patch);
        await db.query("rollback to savepoint hidden_recording");
      }
      await db.query("savepoint unpublished_recording");
      await update("mobile_unpublished_at=now(),web_unpublished_at=now()");
      for (const row of await read()) assert.equal(row, undefined);
      await db.query("rollback to savepoint unpublished_recording");
      await db.query("savepoint member_recording");
      await update("mobile_visibility='members'");
      for (const row of (await read(null)).slice(0, 3)) assert.equal(row, undefined);
      for (const row of (await read("following")).slice(0, 3)) assert.equal(row, undefined);
      for (const row of (await read("blocked")).slice(0, 3)) assert.equal(row, undefined);
      for (const row of (await read()).slice(0, 3)) assert.equal(row?.id, recording);
      await db.query("rollback to savepoint member_recording");
      await db.query("savepoint unlisted_recording");
      await update("visibility='unlisted'");
      assert.ok(!(await db.query("select id from public.web_recordings($1)", [slug])).rows.some(row => row.id === recording));
      assert.equal((await db.query("select id from public.web_recordings($1,$2)", [slug, recording])).rows[0].id, recording);
      await db.query("rollback to savepoint unlisted_recording");
    });

    await t.test("invalid days and unsupported date ranges are refused by PostgreSQL", async () => {
      for (const day of ["2026-02-29", "2026-04-31", "infinity", "-infinity", "10000-01-01"]) {
        await db.query("savepoint invalid_day");
        await assert.rejects(update("service_date=$2", [day]));
        await db.query("rollback to savepoint invalid_day");
      }
    });

    await t.test("existing server-only grants and row security remain closed to browser writes and RPC calls", async () => {
      assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.stream_recordings'::regclass")).rows[0].relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) {
        assert.equal((await db.query("select has_column_privilege($1,'public.stream_recordings','service_date','UPDATE') allowed", [role])).rows[0].allowed, false);
        for (const signature of ["web_recordings(text,uuid,integer)", "mobile_media_archive(text,text,text,timestamptz,uuid,integer)", "mobile_media_detail(text,text,uuid)", "mobile_media_series_items(text,text,text)"]) {
          assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).rows[0].allowed, false, `${role}: ${signature}`);
          assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [`public.${signature}`])).rows[0].allowed, true);
        }
      }
      await db.query("set local role service_role");
      for (const row of await read()) assert.equal(row?.id, recording);
      await db.query("reset role");
    });
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
});
