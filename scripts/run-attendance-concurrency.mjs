#!/usr/bin/env node
/**
 * Applies the attendance migrations to a disposable database and runs the
 * two-connection concurrency tests against it.
 *
 * This observes the attendance functions' behaviour under real contention. It
 * is deliberately *not* a migration rehearsal: `bootstrap.sql` creates only the
 * dependencies 0055/0056 reference, so a plain Postgres can execute them. A
 * full rehearsal against a Supabase project remains a separate, pending gate.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const url = process.env.FAITHFUL_TEST_DATABASE_URL;

if (!url) {
  console.error("FAIL set FAITHFUL_TEST_DATABASE_URL to a disposable Postgres target.");
  process.exit(1);
}
if (/prod/i.test(url)) {
  console.error("FAIL the target looks like production; refusing.");
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: url });
await client.connect();

const files = [
  "tests/database/fixtures/bootstrap.sql",
  "supabase/migrations/0055_attendance_authority.sql",
  "supabase/migrations/0056_attendance_batch.sql",
  "supabase/migrations/0057_attendance_report_totals.sql",
  "supabase/migrations/0058_attendance_detections.sql",
  "supabase/migrations/0059_attendance_checkin_sessions.sql",
  "supabase/migrations/0060_faithful_media_publication.sql",
  "supabase/migrations/0061_faithful_media_eligibility.sql",
  "supabase/migrations/0062_faithful_media_object_identity.sql",
  "supabase/migrations/0063_faithful_giving.sql",
  "supabase/migrations/0064_dashboard_hot_path_indexes.sql",
];

try {
  for (const file of files) {
    await client.query(readFileSync(file, "utf8"));
    console.log(`applied ${file}`);
  }
} catch (error) {
  console.error(`FAIL applying schema: ${error.message}`);
  process.exit(1);
} finally {
  await client.end();
}

const result = spawnSync(
  "npx",
  [
    "tsx",
    "--test",
    "tests/database/attendance-concurrency.test.ts",
    "tests/database/checkin-sessions.test.ts",
    "tests/database/media-publication.test.ts",
    "tests/database/giving.test.ts",
    "tests/database/query-plans.test.ts",
  ],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
