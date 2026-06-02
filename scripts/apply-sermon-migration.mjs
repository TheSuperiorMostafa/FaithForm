#!/usr/bin/env node
/**
 * Applies sermon builder migrations (0006 + 0008).
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres.[ref]:[password]@...pooler.supabase.com:6543/postgres" pnpm db:sermon
 *
 * Get DATABASE_URL from Supabase Dashboard → Project Settings → Database → Connection string (URI)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../supabase/migrations");
const migrationFiles = [
  "0006_sermon_builder.sql",
  "0008_simple_sermon_mode.sql",
];

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL. Set it to your Supabase Postgres connection string, then run:\n  pnpm db:sermon",
  );
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}…`);
    await client.query(sql);
  }
  console.log(
    "Done. Tables: church_settings, sermon_series, sermons, sermon_assets (+ simple mode columns)",
  );
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
