#!/usr/bin/env node
/**
 * Applies the announcement all-day flag (0066) and the weekly-email attachment
 * store (0067).
 *
 * Both are additive and safe to re-run. The attachment bytes live in the
 * `communication-attachments` bucket — run `pnpm storage:buckets` as well, or
 * uploads will fail against a bucket that does not exist.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:communications
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  "0066_announcement_all_day.sql",
  "0067_communication_attachments.sql",
];

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

  for (const migration of MIGRATIONS) {
    const sql = readFileSync(
      join(__dirname, "../supabase/migrations", migration),
      "utf8",
    );
    console.log(`Applying ${migration}…`);
    await client.query(sql);
  }

  console.log(
    "Done. All-day events now keep their own date, and the weekly email can " +
      "carry files. Run `pnpm storage:buckets` if you have not already.",
  );
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
