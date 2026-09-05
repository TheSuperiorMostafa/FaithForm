#!/usr/bin/env node
/**
 * Applies the phone-call scoring rubric (0070) and children's check-in (0071).
 *
 * Both are additive and safe to re-run. 0070 rescales the surviving 0–100
 * scores to 1–10 exactly once — it stamps `version: 1` into each breakdown
 * first, and only rescales rows carrying that stamp, so running it twice does
 * not divide anything by ten again.
 *
 * 0071 stores person documents in the `member-files` bucket — run
 * `pnpm storage:buckets` as well, or uploads will fail against a bucket that
 * does not exist.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:checkin
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  "0070_phone_call_scoring_v2.sql",
  "0071_households_and_checkin.sql",
];

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL. Set the Supabase Postgres URI from Dashboard → Settings → Database.",
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
    "Done. Call scores now carry a call type, and households, rooms and " +
      "check-in exist. Run `pnpm storage:buckets` if you have not already.",
  );
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
