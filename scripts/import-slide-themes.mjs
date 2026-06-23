#!/usr/bin/env node
/**
 * Bulk-import slide theme images + metadata into Supabase.
 *
 * Usage:
 *   node scripts/import-slide-themes.mjs path/to/manifest.json
 *
 * Manifest format (JSON array):
 * [
 *   {
 *     "id": "advent-candles",
 *     "name": "Advent Candles",
 *     "description": "Warm candlelight for Advent series",
 *     "category": "seasonal",
 *     "tags": ["advent", "candles", "warm"],
 *     "seasonal_tags": ["advent", "christmas"],
 *     "symbol_tags": ["candles", "light"],
 *     "visual_style": ["photographic", "warm"],
 *     "text_color": "FFFFFF",
 *     "accent_color": "FDE68A",
 *     "font_head": "Georgia",
 *     "font_body": "Georgia",
 *     "featured": false,
 *     "sort_order": 100,
 *     "file": "./images/advent-candles.jpg"
 *   }
 * ]
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUCKET = "sermon-themes";

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
  console.error("Usage: node scripts/import-slide-themes.mjs path/to/manifest.json");
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

async function ensureBucket() {
  const { data: buckets, error: listError } =
    await supabase.storage.listBuckets();
  if (listError) {
    console.error("Could not list storage buckets:", listError.message);
    process.exit(1);
  }

  if (buckets?.some((bucket) => bucket.name === BUCKET || bucket.id === BUCKET)) {
    return;
  }

  console.log(`Creating storage bucket "${BUCKET}"…`);
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5242880,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
  });

  if (createError) {
    console.error(`Failed to create bucket "${BUCKET}":`, createError.message);
    console.error(
      "Run `pnpm db:slide-themes` with DATABASE_URL if the slide_themes migration is not applied yet.",
    );
    process.exit(1);
  }
}

await ensureBucket();

const { error: tableCheckError } = await supabase
  .from("slide_themes")
  .select("id", { count: "exact", head: true });

if (tableCheckError) {
  console.error(
    "slide_themes table is not available:",
    tableCheckError.message,
  );
  console.error(
    "\nApply migration 0021 first:\n  DATABASE_URL=\"postgresql://...\" pnpm db:slide-themes\n",
  );
  process.exit(1);
}

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
    name: entry.name ?? id,
    description: entry.description ?? "",
    category: entry.category ?? "contemporary",
    tags: entry.tags ?? [],
    seasonal_tags: entry.seasonal_tags ?? entry.seasonalTags ?? [],
    symbol_tags: entry.symbol_tags ?? entry.symbolTags ?? [],
    visual_style: entry.visual_style ?? entry.visualStyle ?? [],
    background_type: "image",
    image_path: storagePath,
    bg: entry.bg ?? null,
    bg_css: entry.bg_css ?? entry.bgCss ?? null,
    text_color: (entry.text_color ?? entry.textColor ?? "FFFFFF").replace(/^#/, ""),
    accent_color: (entry.accent_color ?? entry.accentColor ?? "C9A227").replace(/^#/, ""),
    font_head: entry.font_head ?? entry.fontHead ?? "Georgia",
    font_body: entry.font_body ?? entry.fontBody ?? "Georgia",
    italic_ref: entry.italic_ref ?? entry.italicRef ?? false,
    text_shadow: entry.text_shadow ?? entry.textShadow ?? true,
    featured: entry.featured ?? false,
    sort_order: entry.sort_order ?? entry.sortOrder ?? 100,
    active: entry.active ?? true,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("slide_themes")
    .upsert(row, { onConflict: "id" });

  if (upsertError) {
    console.error(`DB upsert failed for ${id}:`, upsertError.message);
    failed += 1;
    continue;
  }

  uploaded += 1;
  console.log(`✓ ${id} (${basename(filePath)})`);
}

console.log(`\nDone. ${uploaded} imported, ${failed} failed.`);
