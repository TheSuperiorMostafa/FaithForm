#!/usr/bin/env node
/**
 * Read-only, one-object-at-a-time backup of Supabase Storage bytes. The
 * database archive contains storage.objects metadata, not these bytes.
 *
 * Supply NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY through a private
 * local environment file, plus:
 *   FAITHFORM_STORAGE_BACKUP_DIR=<private ignored directory>
 *   FAITHFORM_BACKUP_DATABASE_PASSWORD_FILE=<private password file>
 *   FAITHFORM_DB_POOLER_HOST=<project session pooler host>
 *   FAITHFORM_DB_TARGET=production-read-only
 *
 * The destination must already exist with private permissions. No upload,
 * delete, or database mutation is performed.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, statSync, writeFileSync, existsSync, openSync, closeSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

if (process.env.FAITHFORM_DB_TARGET !== "production-read-only") {
  throw new Error("Set FAITHFORM_DB_TARGET=production-read-only to acknowledge the source");
}
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const host = process.env.FAITHFORM_DB_POOLER_HOST;
const passwordFile = process.env.FAITHFORM_BACKUP_DATABASE_PASSWORD_FILE;
const output = process.env.FAITHFORM_STORAGE_BACKUP_DIR;
if (!projectUrl || !secret || !host || !passwordFile || !output) {
  throw new Error("Missing production URL, secret, pooler host, password file, or backup directory");
}
const project = new URL(projectUrl);
if (project.protocol !== "https:" || !/^([a-z0-9-]+)\.supabase\.co$/i.test(project.hostname)) {
  throw new Error("Expected a Supabase project URL");
}
const ref = project.hostname.split(".")[0];
if (!/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/i.test(host)) {
  throw new Error("Expected a Supabase session pooler host");
}
const password = readFileSync(passwordFile, "utf8").trim();
if (!password || password.includes("=")) throw new Error("Password file must contain only the database password");
const root = resolve(output);
if (!root.split("/").at(-1)?.startsWith(".env.storage-backup-") || !root.endsWith(".local")) {
  throw new Error("Use a private, Git-ignored .env.storage-backup-*.local directory");
}
if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
if ((statSync(root).mode & 0o077) !== 0) throw new Error("Backup directory must not be accessible to other users");
process.umask(0o077);

const storage = createClient(projectUrl, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = spawnSync(process.env.FAITHFORM_PSQL_BIN || "psql", [
  "--no-psqlrc", "-X", "-qAt", "-c",
  `select coalesce(json_agg(json_build_object(
      'bucket_id', bucket_id,
      'name', name,
      'reported_size', metadata->>'size'
    ) order by bucket_id, name), '[]'::json)::text from storage.objects`,
], {
  encoding: "utf8",
  timeout: 30000,
  maxBuffer: 8 * 1024 * 1024,
  env: {
    ...process.env,
    PGHOST: host,
    PGPORT: "5432",
    PGUSER: `postgres.${ref}`,
    PGDATABASE: "postgres",
    PGPASSWORD: password,
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=15000",
  },
});
if (inventory.status !== 0) throw new Error("Read-only Storage inventory query failed");
const rows = JSON.parse(inventory.stdout.trim());

const entries = [];
let totalBytes = 0;
for (const [index, row] of rows.entries()) {
  const filename = `${sha256(Buffer.from(`${row.bucket_id}\0${row.name}`))}.bin`;
  const path = join(root, filename);
  const { data, error } = await storage.storage.from(row.bucket_id).download(row.name);
  if (error || !data) throw new Error(`Storage download failed at item ${index + 1} of ${rows.length}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  const reportedSize = /^\d+$/.test(row.reported_size ?? "") ? Number(row.reported_size) : null;
  if (reportedSize !== null && bytes.length !== reportedSize) {
    throw new Error(`Storage size mismatch at item ${index + 1} of ${rows.length}`);
  }
  const fileHash = sha256(bytes);
  if (existsSync(path)) {
    if (sha256(readFileSync(path)) !== fileHash) {
      throw new Error(`Previously saved object changed at item ${index + 1} of ${rows.length}`);
    }
  } else {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
  }
  if (sha256(readFileSync(path)) !== fileHash) {
    rmSync(path, { force: true });
    throw new Error(`Local checksum mismatch at item ${index + 1} of ${rows.length}`);
  }
  totalBytes += bytes.length;
  entries.push({ bucket: row.bucket_id, object: row.name, file: filename, bytes: bytes.length, sha256: fileHash });
  if ((index + 1) % 50 === 0) console.log(`Verified ${index + 1}/${rows.length} Storage objects`);
  await new Promise((done) => setTimeout(done, 100));
}
writeFileSync(join(root, "manifest.json"), JSON.stringify({ project: ref, createdAt: new Date().toISOString(), totalBytes, entries }, null, 2), { mode: 0o600, flag: "wx" });
console.log(`PASS: ${entries.length} Storage objects, ${totalBytes} bytes, each downloaded and checksum-verified.`);
