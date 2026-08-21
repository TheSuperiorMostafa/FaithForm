#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const safeTargets = new Set(["disposable", "nonproduction"]);
const target = process.env.FAITHFORM_DB_TARGET;
const databaseUrl = process.env.DATABASE_URL;
const all = process.argv.includes("--all");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;

if (!safeTargets.has(target ?? "")) {
  console.error(
    "Refusing migration: set FAITHFORM_DB_TARGET=disposable or nonproduction.",
  );
  process.exit(1);
}
if (!databaseUrl) {
  console.error("Refusing migration: DATABASE_URL is required.");
  process.exit(1);
}
if (all === Boolean(only)) {
  console.error("Choose exactly one mode: --all or --only <filename>.");
  process.exit(1);
}

const files = readdirSync("supabase/migrations")
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();
const selected = all ? files : files.filter((file) => file === only);
if (selected.length === 0) {
  console.error("The requested migration file does not exist.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.faithform_source_migrations (
      filename text primary key,
      sha256 text not null,
      applied_at timestamptz not null default clock_timestamp()
    );
  `);

  for (const filename of selected) {
    const sql = readFileSync(`supabase/migrations/${filename}`, "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const { rows } = await client.query(
      "select sha256 from supabase_migrations.faithform_source_migrations where filename = $1",
      [filename],
    );
    if (rows[0]?.sha256 === sha256) {
      console.log(`SKIP ${filename}`);
      continue;
    }
    if (rows[0]) {
      throw new Error(`${filename} changed after it was applied`);
    }

    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into supabase_migrations.faithform_source_migrations(filename, sha256) values ($1, $2)",
        [filename, sha256],
      );
      await client.query("commit");
      console.log(`APPLIED ${filename}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} catch (error) {
  console.error(`Migration rehearsal failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
