#!/usr/bin/env node
/**
 * Creates the storage buckets FaithForm expects. Safe to re-run.
 *
 * `stream-recordings` was never created in production, so every finished
 * broadcast produced a database row pointing at a bucket that did not exist —
 * signing a playback URL failed and the Media page said "processing" forever.
 *
 * Usage:
 *   pnpm storage:buckets
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY) from the environment or .env.local.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * No fileSizeLimit is set on purpose. A per-bucket limit cannot exceed the
 * project's global upload limit, and asking for more is rejected outright —
 * leaving it null makes the bucket inherit whatever the project allows.
 */
const BUCKETS = [
  { name: "stream-recordings", public: false },
  { name: "church-logos", public: true },
  { name: "church-covers", public: true },
  { name: "social-graphics", public: true },
  // Church-uploaded sermon slide backgrounds. Public so PPTX export and the
  // theme picker can read the image without signing every URL.
  { name: "sermon-themes", public: true },
];

let failed = false;

for (const bucket of BUCKETS) {
  const { data: existing } = await supabase.storage.getBucket(bucket.name);

  if (existing) {
    console.log(
      `• ${bucket.name} — already exists (public=${existing.public})`,
    );
    continue;
  }

  const { error } = await supabase.storage.createBucket(bucket.name, {
    public: bucket.public,
  });

  if (error) {
    failed = true;
    console.error(`✗ ${bucket.name} — ${error.message}`);
  } else {
    console.log(`✓ ${bucket.name} — created (public=${bucket.public})`);
  }
}

if (failed) process.exit(1);
console.log("\nStorage buckets are ready.");
