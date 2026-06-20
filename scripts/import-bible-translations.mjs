#!/usr/bin/env node
/**
 * Upload self-generated Bible translation JSON to private Supabase storage.
 *
 * Generate files locally with:
 *   https://github.com/jadenzaleski/bible-translations
 *
 * Usage:
 *   node scripts/import-bible-translations.mjs KJV.json NIV.json ESV.json
 *   node scripts/import-bible-translations.mjs ./output/*.json
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "bible-text";

const LABELS = {
  KJV: "King James Version",
  ESV: "English Standard Version",
  NIV: "New International Version",
  NLT: "New Living Translation",
  CSB: "Christian Standard Bible",
  NKJV: "New King James Version",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    "Usage: node scripts/import-bible-translations.mjs KJV.json [NIV.json ...]",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let uploaded = 0;
let failed = 0;

for (const filePath of files) {
  if (!existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    failed += 1;
    continue;
  }

  const fileName = basename(filePath);
  const code = fileName.replace(/\.json$/i, "").toUpperCase();
  if (!LABELS[code]) {
    console.warn(`Skipping ${fileName} — expected one of: ${Object.keys(LABELS).join(", ")}`);
    failed += 1;
    continue;
  }

  const buffer = readFileSync(filePath);
  const storagePath = `${code}.json`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: "application/json",
      upsert: true,
    });

  if (uploadError) {
    console.error(`Upload failed for ${code}:`, uploadError.message);
    failed += 1;
    continue;
  }

  const { error: upsertError } = await supabase
    .from("bible_text_translations")
    .upsert(
      {
        code,
        label: LABELS[code],
        storage_path: storagePath,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "code" },
    );

  if (upsertError) {
    console.error(`Catalog upsert failed for ${code}:`, upsertError.message);
    failed += 1;
    continue;
  }

  uploaded += 1;
  const mb = (buffer.length / (1024 * 1024)).toFixed(1);
  console.log(`✓ ${code} (${mb} MB) → ${BUCKET}/${storagePath}`);
}

console.log(`\nDone. ${uploaded} uploaded, ${failed} failed.`);
