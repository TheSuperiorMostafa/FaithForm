#!/usr/bin/env node
/**
 * Applies Stripe giving migration (0013).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/apply-stripe-migration.mjs
 *   # or
 *   pnpm db:stripe
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../supabase/migrations/0013_stripe_giving.sql"),
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
  console.log("Applying 0013_stripe_giving.sql…");
  await client.query(sql);
  console.log("Done. Stripe giving tables and church columns are ready.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
