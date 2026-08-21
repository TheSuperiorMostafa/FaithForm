#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const manifest = JSON.parse(
  readFileSync("security/baseline-manifest.json", "utf8"),
);
const localMigrations = readdirSync("supabase/migrations")
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const configuredCronEndpoints = (vercel.crons ?? []).map((cron) => cron.path);
const sourceReport = {
  mode: process.env.DATABASE_URL ? "database-read-only" : "source-only",
  localMigrations,
  expectedFunctions: manifest.functions,
  expectedFunctionGrants: manifest.functionGrants,
  expectedTableGrants: manifest.tableGrants,
  expectedStorage: {
    buckets: manifest.buckets,
    policies: manifest.storagePolicies,
  },
  cronEndpoints: {
    expected: manifest.cronEndpoints,
    configured: configuredCronEndpoints,
    externalScheduler: manifest.externalSchedulerEndpoints,
  },
  productionEnvironment: manifest.productionEnvironment.map((name) => ({
    name,
    configured: Boolean(process.env[name]),
  })),
};

console.log(JSON.stringify(sourceReport, null, 2));

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is unset; deployed-state comparison was not attempted.");
  process.exit(0);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("begin read only");
  const { rows: migrationTables } = await client.query(
    "select to_regclass('supabase_migrations.faithform_source_migrations')::text as source_history, to_regclass('supabase_migrations.schema_migrations')::text as supabase_history",
  );
  let migrations = { rows: [] };
  let migrationHistory = "unavailable";
  if (migrationTables[0]?.source_history) {
    migrations = await client.query(
      "select filename, sha256, applied_at from supabase_migrations.faithform_source_migrations order by filename",
    );
    migrationHistory = "faithform_source_migrations";
  } else if (migrationTables[0]?.supabase_history) {
    migrations = await client.query(
      "select version, name from supabase_migrations.schema_migrations order by version",
    );
    migrationHistory = "schema_migrations";
  }
  const functions = await client.query(
    "select proname from pg_proc join pg_namespace n on n.oid=pronamespace where n.nspname='public' and proname = any($1)",
    [manifest.functions],
  );
  const functionGrants = await client.query(
    `select p.proname, r.rolname,
            has_function_privilege(r.oid, p.oid, 'EXECUTE') as allowed
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join pg_roles r
      where n.nspname = 'public'
        and p.proname = any($1)
        and r.rolname = any($2)
      order by p.proname, r.rolname`,
    [Object.keys(manifest.functionGrants), ["anon", "authenticated", "service_role"]],
  );
  const tableGrants = await client.query(
    `select r.rolname, privilege,
            has_table_privilege(r.oid, $1, privilege) as allowed
       from pg_roles r
       cross join unnest($2::text[]) privilege
      where r.rolname = any($3)
      order by r.rolname, privilege`,
    [
      "public.church_integrations",
      ["SELECT", "INSERT", "UPDATE", "DELETE"],
      ["anon", "authenticated", "service_role"],
    ],
  );
  const policies = await client.query(
    "select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where (schemaname='storage' and tablename='objects') or (schemaname='public' and tablename in ('church_integrations', 'stream_chat_messages')) order by schemaname, tablename, policyname",
  );
  const buckets = await client.query(
    "select id, public from storage.buckets where id = any($1)",
    [manifest.buckets.map((bucket) => bucket.id)],
  );
  const drift = [];
  const foundFunctions = new Set(functions.rows.map((row) => row.proname));
  for (const name of manifest.functions) {
    if (!foundFunctions.has(name)) drift.push(`missing function ${name}`);
  }
  for (const [name, expectedRoles] of Object.entries(manifest.functionGrants)) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const rows = functionGrants.rows.filter(
        (row) => row.proname === name && row.rolname === role,
      );
      const expected = expectedRoles.includes(role);
      if (rows.length === 0 || rows.some((row) => row.allowed !== expected)) {
        drift.push(`function grant ${name} ${role} expected=${expected}`);
      }
    }
  }
  const tableExpected = manifest.tableGrants["public.church_integrations"];
  for (const row of tableGrants.rows) {
    const expected = tableExpected[row.rolname].includes(row.privilege);
    if (row.allowed !== expected) {
      drift.push(
        `table grant church_integrations ${row.rolname} ${row.privilege} expected=${expected}`,
      );
    }
  }
  const policyNames = new Set(policies.rows.map((row) => row.policyname));
  for (const name of manifest.storagePolicies) {
    if (!policyNames.has(name)) drift.push(`missing storage policy ${name}`);
  }
  for (const name of manifest.removedPolicies) {
    if (policyNames.has(name)) drift.push(`removed policy still present ${name}`);
  }
  const bucketById = new Map(buckets.rows.map((row) => [row.id, row]));
  for (const expected of manifest.buckets) {
    const actual = bucketById.get(expected.id);
    if (!actual || actual.public !== expected.public) {
      drift.push(`bucket ${expected.id} missing or public flag differs`);
    }
  }
  if (migrationHistory === "faithform_source_migrations") {
    const applied = new Set(migrations.rows.map((row) => row.filename));
    for (const filename of localMigrations) {
      if (!applied.has(filename)) drift.push(`migration not applied ${filename}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        migrationHistory,
        deployedMigrations: migrations.rows,
        functions: functions.rows,
        functionGrants: functionGrants.rows,
        tableGrants: tableGrants.rows,
        policies: policies.rows,
        buckets: buckets.rows,
        drift,
      },
      null,
      2,
    ),
  );
  await client.query("rollback");
  if (drift.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Drift check failed without mutation: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
