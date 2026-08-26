#!/usr/bin/env node
/**
 * Applies 0055_attendance_authority.sql to an explicitly named, non-production
 * database, then runs the legacy preflight so the operator sees what the
 * backfill would face before running it.
 *
 * Refuses without an explicit target and an explicit acknowledgement, so it
 * cannot be pointed at production by an absent-minded environment variable.
 * See docs/faithful/P6_LEGACY_MIGRATION_AND_RECONCILIATION.md.
 */
import { readFileSync } from "node:fs";

const url = process.env.FAITHFUL_MIGRATION_DATABASE_URL;
const confirmed =
  process.env.FAITHFUL_MIGRATION_CONFIRM === "i-understand-this-is-not-production";

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

const sql = readFileSync("supabase/migrations/0055_attendance_authority.sql", "utf8");

const { Client } = await import("pg");
const client = new Client({ connectionString: url });
await client.connect();

try {
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("Applied 0055_attendance_authority.sql");

  // Preflight, read-only. Reports what the backfill would face rather than
  // doing anything about it.
  const { rows } = await client.query(`
    select
      (select count(*) from public.attendance_records) as legacy_records,
      (select count(*) from public.attendance_entries where status = 'present') as legacy_present,
      (select count(*) from public.attendance_entries
         where status = 'present' and member_id is null) as orphaned_present,
      (select count(*) from (
         select church_id, service_date
         from public.attendance_records
         group by church_id, service_date
         having count(*) > 1
       ) d) as duplicate_church_dates,
      (select count(*) from public.attendance_facts) as new_facts,
      (select count(*) from public.service_occurrences) as occurrences
  `);

  const report = rows[0];
  console.log("\nLegacy preflight (read-only):");
  console.log(`  legacy records            ${report.legacy_records}`);
  console.log(`  legacy present entries    ${report.legacy_present}`);
  console.log(`  present with no member    ${report.orphaned_present}`);
  console.log(`  duplicate church/date     ${report.duplicate_church_dates}`);
  console.log(`  new counted facts         ${report.new_facts}`);
  console.log(`  service occurrences       ${report.occurrences}`);

  if (Number(report.duplicate_church_dates) > 0) {
    console.log(
      "\n  Duplicate church/date records exist. The backfill will refuse until a\n" +
      "  human decides which is authoritative — see the reconciliation runbook.",
    );
  }
  if (Number(report.new_facts) > 0) {
    console.log("\n  Counted facts already exist; a backfill would be incremental.");
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(`FAIL migration rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
