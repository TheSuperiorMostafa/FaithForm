#!/usr/bin/env node
/**
 * Applies 0054_faithful_publication_and_push.sql to an explicitly named,
 * non-production database.
 *
 * Refuses to run without an explicit target and an explicit acknowledgement, so
 * it cannot be pointed at production by an absent-minded environment variable.
 * See docs/faithful/P5_DEPLOYMENT_RUNBOOK.md.
 */
import { readFileSync } from "node:fs";

const url = process.env.FAITHFUL_MIGRATION_DATABASE_URL;
const confirmed = process.env.FAITHFUL_MIGRATION_CONFIRM === "i-understand-this-is-not-production";

if (!url) {
  console.error("FAIL set FAITHFUL_MIGRATION_DATABASE_URL to a non-production database.");
  process.exit(1);
}
if (!confirmed) {
  console.error(
    "FAIL set FAITHFUL_MIGRATION_CONFIRM=i-understand-this-is-not-production to proceed.",
  );
  process.exit(1);
}
if (/prod/i.test(url)) {
  console.error("FAIL the target looks like production; this script will not run against it.");
  process.exit(1);
}

const sql = readFileSync("supabase/migrations/0054_faithful_publication_and_push.sql", "utf8");

const { Client } = await import("pg");
const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("Applied 0054_faithful_publication_and_push.sql");
} catch (error) {
  await client.query("rollback");
  console.error(`FAIL migration rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
