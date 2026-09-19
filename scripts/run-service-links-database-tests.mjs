#!/usr/bin/env node
/**
 * Builds a disposable database from the *entire* migration chain and runs the
 * service/presentation linking database suite against it.
 *
 * Unlike the attendance harness, nothing here is a hand-reduced stand-in: the
 * Supabase platform surface (`tests/database/fixtures/supabase-platform.sql`)
 * is the only fixture, and every file in `supabase/migrations` applies on top
 * of it, in order. So the row level security these tests exercise is the row
 * level security that ships.
 *
 *   FAITHFORM_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres \
 *     node scripts/run-service-links-database-tests.mjs
 *
 * The URL names a server and an *administrative* database; a fresh database is
 * created beside it for each run and dropped afterwards.
 */
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const adminUrl = process.env.FAITHFORM_TEST_DATABASE_URL;

if (!adminUrl) {
  console.error("FAIL set FAITHFORM_TEST_DATABASE_URL to a disposable Postgres server.");
  process.exit(1);
}
if (/prod|supabase\.co|amazonaws|rds/i.test(adminUrl)) {
  console.error("FAIL the target looks like a real deployment; refusing.");
  process.exit(1);
}

const { Client } = await import("pg");
const database = `ff_service_links_${randomUUID().slice(0, 8)}`;
const target = new URL(adminUrl);
const databaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
})();

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`create database ${database}`);
await admin.end();

// 0007 seeds a named church's roster; in a fresh database that church has to
// exist first, exactly as it did when the migration was written.
const SEED_CHURCH =
  "insert into public.churches (id, name) values ('11111111-1111-1111-1111-111111111111', 'Seed church') on conflict do nothing";

let status = 1;
try {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(readFileSync("tests/database/fixtures/supabase-platform.sql", "utf8"));
    const files = readdirSync("supabase/migrations")
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    for (const file of files) {
      if (file === "0007_grace_members.sql") await client.query(SEED_CHURCH);
      try {
        await client.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
      } catch (error) {
        console.error(`FAIL applying ${file}: ${error.message}`);
        throw error;
      }
    }
    console.log(`applied ${files.length} migrations to ${database} on ${target.host}`);
  } finally {
    await client.end();
  }

  const result = spawnSync(
    process.execPath,
    // Exercise the real projection and tenant constraints in an isolated database.
    [
      "--import", "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/database/service-links.test.ts",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, FAITHFORM_TEST_DATABASE_URL: databaseUrl, FAITHFORM_FULL_SCHEMA: "1" },
    },
  );
  status = result.status ?? 1;
} finally {
  const cleanup = new Client({ connectionString: adminUrl });
  await cleanup.connect();
  await cleanup.query(`drop database if exists ${database} with (force)`);
  await cleanup.end();
}

process.exit(status);
