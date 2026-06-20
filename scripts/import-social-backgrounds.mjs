#!/usr/bin/env node
/**
 * Bulk-import tagged social background images into Supabase.
 *
 * Usage:
 *   node scripts/import-social-backgrounds.mjs path/to/manifest.json
 *
 * Manifest format (JSON array):
 * [
 *   {
 *     "id": "worship-hands",
 *     "tags": ["worship", "prayer"],
 *     "attribution": "Photo by Jane Doe on Unsplash",
 *     "source_url": "https://unsplash.com/photos/...",
 *     "sort_order": 1,
 *     "file": "./images/worship-hands.jpg"
 *   }
 * ]
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = "social-backgrounds";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error(
    "Usage: node scripts/import-social-backgrounds.mjs path/to/manifest.json",
  );
  process.exit(1);
}

const manifestAbs = resolve(manifestPath);
const manifestDir = dirname(manifestAbs);
const entries = JSON.parse(readFileSync(manifestAbs, "utf8"));

if (!Array.isArray(entries)) {
  console.error("Manifest must be a JSON array");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function mimeForExt(ext) {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

let uploaded = 0;
let failed = 0;

for (const entry of entries) {
  const id = entry.id?.trim();
  if (!id) {
    console.warn("Skipping entry without id");
    failed += 1;
    continue;
  }

  const tags = entry.tags ?? ["default"];
  if (!Array.isArray(tags) || tags.length === 0) {
    console.warn(`Skipping ${id}: tags must be a non-empty array`);
    failed += 1;
    continue;
  }

  const filePath = resolve(manifestDir, entry.file ?? `${id}.jpg`);
  if (!existsSync(filePath)) {
    console.error(`Missing file for ${id}: ${filePath}`);
    failed += 1;
    continue;
  }

  const ext = extname(filePath) || ".jpg";
  const storagePath = `${id}${ext}`;
  const fileBuffer = readFileSync(filePath);
  const contentType = mimeForExt(ext);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    console.error(`Upload failed for ${id}:`, uploadError.message);
    failed += 1;
    continue;
  }

  const row = {
    id,
    storage_path: storagePath,
    tags,
    attribution: entry.attribution ?? null,
    source_url: entry.source_url ?? entry.sourceUrl ?? null,
    sort_order: entry.sort_order ?? entry.sortOrder ?? 100,
    active: entry.active ?? true,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("social_background_images")
    .upsert(row, { onConflict: "id" });

  if (upsertError) {
    console.error(`DB upsert failed for ${id}:`, upsertError.message);
    failed += 1;
    continue;
  }

  uploaded += 1;
  console.log(`✓ ${id} (${basename(filePath)}) [${tags.join(", ")}]`);
}

console.log(`\nDone. ${uploaded} imported, ${failed} failed.`);
