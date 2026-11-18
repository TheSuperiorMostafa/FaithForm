#!/usr/bin/env node
// Builds a fresh disposable database (bootstrap + sermon-media prerequisites +
// 0167), runs tests/database/sermon-media.test.ts against it, and drops it.
//
//   FAITHFORM_PG_HOST=localhost FAITHFORM_PG_PORT=5432 pnpm test:sermon-media-database
//
// Refuses hosts that look like a real deployment.
import { execFileSync } from "node:child_process";

const host = process.env.FAITHFORM_PG_HOST ?? "localhost";
const port = process.env.FAITHFORM_PG_PORT ?? "5432";
const user = process.env.FAITHFORM_PG_USER ?? "postgres";
if (/prod|supabase\.co|amazonaws|rds/i.test(host)) {
  console.error(`Refusing to run against a host that looks like a real deployment: ${host}`);
  process.exit(1);
}

const db = `faithform_sermon_media_${process.pid}`;
const psql = (args) =>
  execFileSync("psql", ["-h", host, "-p", port, "-U", user, "-v", "ON_ERROR_STOP=1", "-q", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });

psql(["-d", "postgres", "-c", `create database ${db}`]);
let status = 0;
try {
  for (const file of [
    "tests/database/fixtures/bootstrap.sql",
    "tests/database/fixtures/sermon-media-prereqs.sql",
    "supabase/migrations/0167_sermon_media.sql",
  ]) {
    psql(["-d", db, "-f", file]);
  }
  try {
    execFileSync("pnpm", ["exec", "tsx", "--test", "tests/database/sermon-media.test.ts"], {
      stdio: "inherit",
      env: {
        ...process.env,
        FAITHFORM_SERMON_MEDIA_DATABASE_URL: `postgres://${user}@${host}:${port}/${db}`,
      },
    });
  } catch {
    status = 1;
  }
} finally {
  psql(["-d", "postgres", "-c", `drop database if exists ${db}`]);
}
process.exit(status);
