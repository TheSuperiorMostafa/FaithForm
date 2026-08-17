#!/usr/bin/env node
/**
 * Applies the announcement email queue migration (0048).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:email-queue
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../supabase/migrations/0048_announcement_email_queue.sql"),
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
  console.log("Applying 0048_announcement_email_queue.sql…");
  await client.query(sql);
  console.log(
    "Done. announcement_email_queue is ready — events stay in the weekly " +
      "email because someone added them, and the queue resets each Monday.",
  );
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
