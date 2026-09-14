#!/usr/bin/env node
/**
 * Applies the sermon history migration (0075).
 *
 * Needs 0068 first (`pnpm db:sermon-publication`). Apply before deploying the
 * code that pages sermon notes by preached date: the archive function's
 * signature changes, and the service reports a missing function as
 * "unavailable" rather than as an empty list.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:sermon-history
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../supabase/migrations/0075_sermon_history_order.sql"),
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
  ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
    ? false
    : { rejectUnauthorized: false },
});

try {
  await client.connect();

  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'sermons'
        and column_name = 'mobile_visibility'`,
  );
  if (rows.length === 0) {
    console.error(
      "Migration 0068 is not applied (sermons.mobile_visibility is missing). " +
        "Run `pnpm db:sermon-publication` first.",
    );
    process.exit(1);
  }

  console.log("Applying 0075_sermon_history_order.sql…");
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(
    "Done. Sermon notes in the app are now listed by the day they were preached.",
  );
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("Migration failed:", err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
