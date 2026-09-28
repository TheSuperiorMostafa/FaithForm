#!/usr/bin/env node
// Apply only the reviewed September 2026 release batches. Never replay the
// complete source migration directory against the already-running project.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const projectRef = "wwiclymyfplsyezxyzva";
const batches = {
  "pre-web": Array.from({ length: 13 }, (_, index) => 114 + index),
  "post-web": [110, 111, 112, 113],
};
const batch = process.argv.find((arg) => arg.startsWith("--batch="))?.slice(8);
const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7);
const target = process.env.FAITHFORM_DB_TARGET;
if (!batches[batch] || !["plan", "apply"].includes(mode)) {
  throw new Error("Use --batch=pre-web|post-web and --mode=plan|apply");
}
if (!mode || !["production", "disposable"].includes(target)) {
  throw new Error("FAITHFORM_DB_TARGET must be production or disposable");
}
if (target === "production" && process.env.FAITHFORM_PRODUCTION_PROJECT_REF !== projectRef) {
  throw new Error("Production project reference does not match this release");
}

const passwordPath = process.env.FAITHFORM_DB_PASSWORD_FILE;
if (!passwordPath) throw new Error("FAITHFORM_DB_PASSWORD_FILE is required");
const password = readFileSync(passwordPath, "utf8").replace(/\r?\n$/, "");
if (!password) throw new Error("Database password file is empty");

const config = target === "production"
  ? {
      host: "aws-1-us-west-2.pooler.supabase.com",
      port: 5432,
      database: "postgres",
      user: `postgres.${projectRef}`,
      password,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.FAITHFORM_DB_HOST ?? "127.0.0.1",
      port: Number(process.env.FAITHFORM_DB_PORT),
      database: process.env.FAITHFORM_DB_NAME,
      user: process.env.FAITHFORM_DB_USER ?? "postgres",
      password,
      ssl: false,
    };
if (!config.port || !config.database) throw new Error("Database connection is incomplete");

const files = readdirSync("supabase/migrations");
const migration = (number) => {
  const matches = files.filter((file) => file.startsWith(`${String(number).padStart(4, "0")}_`) && file.endsWith(".sql"));
  if (matches.length !== 1) throw new Error(`Expected one source file for migration ${number}`);
  const filename = matches[0];
  const sql = readFileSync(`supabase/migrations/${filename}`, "utf8");
  return { filename, sql, sha256: createHash("sha256").update(sql).digest("hex") };
};
const selected = batches[batch].map(migration);
const required = batches["pre-web"].map(migration);
const client = new pg.Client({ ...config, connectionTimeoutMillis: 10000 });

try {
  await client.connect();
  const { rows: identity } = await client.query(
    "select current_database() as database, current_user as user, (select count(*)::int from public.churches) as churches, to_regclass('supabase_migrations.schema_migrations') is not null as supabase_history",
  );
  if (!identity[0]?.supabase_history || identity[0].churches < 5) {
    throw new Error("Database does not match the verified production restore baseline");
  }
  console.log(`Target: ${target}; batch: ${batch}; database: ${identity[0].database}; churches: ${identity[0].churches}`);

  if (mode === "apply") {
    await client.query("begin");
    await client.query("set local lock_timeout = '3s'");
    await client.query("set local statement_timeout = '120s'");
    await client.query("select pg_advisory_xact_lock(hashtext('faithform_september_2026_release'))");
    await client.query(`create table if not exists supabase_migrations.faithform_source_migrations (
      filename text primary key,
      sha256 text not null,
      applied_at timestamptz not null default clock_timestamp()
    )`);
    await client.query("revoke all on supabase_migrations.faithform_source_migrations from public, anon, authenticated");
  }

  const { rows: historyTable } = await client.query(
    "select to_regclass('supabase_migrations.faithform_source_migrations') is not null as exists",
  );
  const history = new Map();
  if (historyTable[0].exists) {
    const { rows } = await client.query("select filename, sha256 from supabase_migrations.faithform_source_migrations");
    for (const row of rows) history.set(row.filename, row.sha256);
  }
  if (batch === "post-web") {
    for (const item of required) {
      if (history.get(item.filename) !== item.sha256) {
        throw new Error(`Pre-web migration is not recorded: ${item.filename}`);
      }
    }
  }

  for (const item of selected) {
    const recorded = history.get(item.filename);
    if (recorded && recorded !== item.sha256) {
      throw new Error(`Recorded checksum differs from source: ${item.filename}`);
    }
    if (recorded) {
      console.log(`SKIP ${item.filename}`);
      continue;
    }
    if (mode === "plan") {
      console.log(`PLAN ${item.filename} ${item.sha256}`);
      continue;
    }
    await client.query(item.sql);
    await client.query(
      "insert into supabase_migrations.faithform_source_migrations(filename, sha256) values ($1, $2)",
      [item.filename, item.sha256],
    );
    console.log(`APPLIED ${item.filename}`);
  }
  if (mode === "apply") await client.query("commit");
} catch (error) {
  if (mode === "apply") await client.query("rollback").catch(() => {});
  console.error(`Release batch stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
