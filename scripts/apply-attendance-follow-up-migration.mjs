#!/usr/bin/env node
/**
 * Applies the Attendance/Follow-up access split (0043).
 *
 * Also repairs a partially-applied history. Production never received 0014 and
 * only part of 0041, so `attendance_entries.follow_up_sent_at`,
 * `attendance_entries.follow_up_error`,
 * `announcements.facebook_scheduled_publish_time` and
 * `church_users.feature_permissions` were all missing — the first of those made
 * every read of a service's follow-up state fail. Every statement is
 * idempotent, so this is safe on a database that did get them.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:attendance-follow-up
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../supabase/migrations/0043_attendance_follow_up_access.sql"),
  "utf8",
);

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL. Set Supabase Postgres URI from Dashboard → Settings → Database.",
  );
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log("Applying 0043_attendance_follow_up_access.sql…");
  await client.query(sql);

  const { rows } = await client.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'church_users'
             and column_name in ('feature_permissions', 'invited_by', 'invited_at'))
          or (table_name = 'attendance_entries'
             and column_name in ('follow_up_sent_at', 'follow_up_error'))
          or (table_name = 'announcements'
             and column_name in ('unsubmitted_at', 'unsubmitted_by',
                                 'facebook_scheduled_publish_time'))
        )
      order by table_name, column_name`,
  );

  const EXPECTED = 8;
  console.log(`Done. ${rows.length}/${EXPECTED} expected columns present:`);
  for (const row of rows) {
    console.log(`  • ${row.table_name}.${row.column_name}`);
  }
  if (rows.length < EXPECTED) {
    console.error("Some columns are still missing — check the output above.");
    process.exit(1);
  }
  console.log("\nGrant Attendance and Follow-up separately in Settings → Team.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
