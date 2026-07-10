#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const dir = dirname(fileURLToPath(import.meta.url));
const files = [
  "0033_stream_scheduling.sql",
  "0034_stream_recordings.sql",
  "0035_stream_chat.sql",
];

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(join(dir, "../supabase/migrations", file), "utf8");
    console.log(`Applying ${file}…`);
    await client.query(sql);
  }
  console.log("Done.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
