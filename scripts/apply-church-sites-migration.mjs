#!/usr/bin/env node
/**
 * Applies the multi-tenant church websites migration (0042).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:church-sites
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../supabase/migrations/0042_church_sites.sql"),
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
  console.log("Applying 0042_church_sites.sql…");
  await client.query(sql);
  console.log(
    "Done. site_domains, site_themes, site_settings, site_pages, site_sections, " +
      "site_overrides, site_media and site_contact_submissions are ready, " +
      "with the 'grace' and 'classic' themes seeded.",
  );
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
