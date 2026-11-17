import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recorderUploadTypes } from "../support/relay-recorder-mime";

const databaseUrl = process.env.FAITHFORM_TEST_DATABASE_URL;
if (/prod|supabase\.co|amazonaws|rds/i.test(databaseUrl ?? "")) {
  throw new Error("Refusing a production-looking recording storage test target.");
}

test("the recording bucket accepts the actual relay media headers without broadening unrelated storage", {
  skip: !databaseUrl ? "Select a disposable FAITHFORM_TEST_DATABASE_URL; this test rolls back its bucket changes." : false,
}, async t => {
  const { Client } = await import("pg");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("begin");
  t.after(async () => { await db.query("rollback"); await db.end(); });
  const migration = readFileSync("supabase/migrations/0167_recording_segment_upload_mime.sql", "utf8");
  const types = recorderUploadTypes();
  assert.equal(types.segment, "video/iso.segment");
  assert.equal(types.init, "video/mp4");
  const read = async (id = "stream-recordings") => (await db.query(
    "select id,name,public,file_size_limit::text,allowed_mime_types from storage.buckets where id=$1", [id],
  )).rows[0];
  const other = `qa-mime-${randomUUID()}`;
  await db.query("insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values($1,$1,true,1234,array['image/png'])", [other]);
  const otherBefore = await read(other);

  await t.test("the existing complete-file allowlist gains exactly the uploader's segment type", async () => {
    await db.query(readFileSync("supabase/migrations/0148_stream_recordings_bucket.sql", "utf8"));
    const before = await read();
    assert.ok(!before.allowed_mime_types.includes(types.segment), "fixture must expose the original rejected segment header");
    assert.ok(before.allowed_mime_types.includes(types.init));
    assert.equal((await db.query(migration)).rowCount, 1);
    assert.deepEqual(await read(), { ...before, allowed_mime_types: [...before.allowed_mime_types, types.segment] });
    assert.equal((await db.query(migration)).rowCount, 0, "reapplication must be a no-op");
  });

  await t.test("custom permitted types, privacy, and upload limits are preserved", async () => {
    await db.query("update storage.buckets set allowed_mime_types=array['video/mp4','video/quicktime','application/vnd.qa-video'],public=false,file_size_limit=777 where id='stream-recordings'");
    const before = await read();
    await db.query(migration);
    assert.deepEqual(await read(), { ...before, allowed_mime_types: [...before.allowed_mime_types, types.segment] });
  });

  await t.test("unrestricted null and empty lists remain unrestricted", async () => {
    for (const allowed of [null, []]) {
      await db.query("update storage.buckets set allowed_mime_types=$1 where id='stream-recordings'", [allowed]);
      const before = await read();
      assert.equal((await db.query(migration)).rowCount, 0);
      assert.deepEqual(await read(), before);
    }
  });

  await t.test("existing exact and wildcard segment allowances are left unchanged", async () => {
    for (const allowed of [["video/mp4", types.segment], ["video/*"], ["*/*"]]) {
      await db.query("update storage.buckets set allowed_mime_types=$1 where id='stream-recordings'", [allowed]);
      const before = await read();
      assert.equal((await db.query(migration)).rowCount, 0);
      assert.deepEqual(await read(), before);
    }
  });

  await t.test("other buckets retain their MIME restrictions and access settings", async () => {
    assert.deepEqual(await read(other), otherBefore);
  });
});
