#!/usr/bin/env node
/**
 * Rehearse a full PostgreSQL archive backup and restore on one disposable,
 * loopback-only server. This never connects to or validates a production backup.
 *
 * FAITHFORM_DB_TARGET=disposable \
 *   FAITHFORM_TEST_DATABASE_URL=postgres://localhost:5432/postgres \
 *   FAITHFORM_PG_BIN_DIR=/path/to/postgresql/bin \
 *   node scripts/rehearse-backup-restore.mjs
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const adminUrl = process.env.FAITHFORM_TEST_DATABASE_URL;
if (process.env.FAITHFORM_DB_TARGET !== "disposable") {
  throw new Error("Set FAITHFORM_DB_TARGET=disposable for an isolated local server");
}
if (!adminUrl) throw new Error("FAITHFORM_TEST_DATABASE_URL is required");
const parsed = new URL(adminUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
  throw new Error("Refusing to rehearse against a non-loopback database");
}
if (parsed.pathname === "/" || !parsed.pathname) {
  throw new Error("The administrative database name is required");
}

const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const sourceName = `ff_backup_source_${runId}`;
const restoredName = `ff_backup_restored_${runId}`;
const scratch = mkdtempSync(join(tmpdir(), "faithform-restore-"));
const archive = join(scratch, "synthetic-db.dump");
const dbUrl = (name) => {
  const value = new URL(adminUrl);
  value.pathname = `/${name}`;
  return value.toString();
};
const bin = (name) => join(process.env.FAITHFORM_PG_BIN_DIR || "", name);
const run = (name, args) => {
  const result = spawnSync(bin(name), args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} failed: ${result.error?.message || result.stderr?.trim() || result.status}`);
  }
};
const connect = async (url) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
};
const fingerprint = async (client) => {
  const { rows } = await client.query(`
    select
      (select count(*)::int from public.churches) as churches,
      (select count(*)::int from public.members) as members,
      (select count(*)::int from public.announcements) as announcements,
      (select md5(string_agg(id::text, ',' order by id)) from public.churches) as church_ids,
      (select md5(string_agg(id::text, ',' order by id)) from public.members) as member_ids,
      (select md5(string_agg(id::text, ',' order by id)) from public.announcements) as announcement_ids,
      (select relrowsecurity from pg_class where oid = 'public.members'::regclass) as member_rls,
      (select reloptions @> array['security_invoker=true'] from pg_class
       where oid = 'public.announcements_with_status'::regclass) as invoker_view,
      has_column_privilege('authenticated', 'public.members', 'medical_notes', 'select')
        as staff_can_read_medical_notes
  `);
  return rows[0];
};

const admin = await connect(adminUrl);
let source;
let restored;
try {
  await admin.query(`create database ${sourceName}`);
  source = await connect(dbUrl(sourceName));
  await source.query(readFileSync("tests/database/fixtures/supabase-platform.sql", "utf8"));
  const files = readdirSync("supabase/migrations")
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    if (file === "0007_grace_members.sql") {
      await source.query("insert into public.churches (id, name) values ('11111111-1111-1111-1111-111111111111', 'Seed church') on conflict do nothing");
    }
    await source.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }

  for (let i = 0; i < 3; i++) {
    const churchId = randomUUID();
    await source.query("insert into public.churches (id, name, slug) values ($1, $2, $3)",
      [churchId, `Restore church ${i + 1}`, `restore-${runId}-${i}`]);
    await source.query("insert into public.members (church_id, first_name, last_name) values ($1, 'Synthetic', $2)",
      [churchId, `Member ${i + 1}`]);
    await source.query("insert into public.announcements (church_id, event_title, title) values ($1, 'Synthetic event', 'Synthetic event')",
      [churchId]);
  }
  const expected = await fingerprint(source);
  if (expected.churches !== 4 || !expected.member_rls || !expected.invoker_view || expected.staff_can_read_medical_notes) {
    throw new Error(`The synthetic source is not valid: ${JSON.stringify(expected)}`);
  }
  await source.end();
  source = undefined;

  run("pg_dump", ["--format=custom", "--file", archive, dbUrl(sourceName)]);
  await admin.query(`create database ${restoredName}`);
  run("pg_restore", ["--exit-on-error", "--no-owner", "--dbname", dbUrl(restoredName), archive]);
  restored = await connect(dbUrl(restoredName));
  const actual = await fingerprint(restored);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Restore mismatch: ${JSON.stringify({ expected, actual })}`);
  }
  console.log(`PASS: ${files.length} migrations; archive restored with four synthetic churches, matching record fingerprints, RLS, view settings, and medical-note grants.`);
} finally {
  if (source) await source.end();
  if (restored) await restored.end();
  await admin.query(`drop database if exists ${restoredName} with (force)`);
  await admin.query(`drop database if exists ${sourceName} with (force)`);
  await admin.end();
  rmSync(scratch, { recursive: true, force: true });
}
