#!/usr/bin/env node
/**
 * Build import manifest + optimized JPEGs from PWPT Pexels theme folder.
 *
 * Usage:
 *   node scripts/generate-pwpt-theme-manifest.mjs [sourceDir] [outputDir]
 *
 * Defaults:
 *   source: ~/Downloads/PWPT Themes
 *   output images: data/sermon-theme-import/
 *   manifest: data/pwpt-themes-manifest.json
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MAX_WIDTH = 1920;
const MAX_BYTES = 4.5 * 1024 * 1024;
const JPEG_QUALITY_START = 82;

const COLOR_NAMES = [
  { name: "Midnight", r: 20, g: 30, b: 60 },
  { name: "Forest", r: 30, g: 80, b: 40 },
  { name: "Ocean", r: 20, g: 80, b: 120 },
  { name: "Sky", r: 100, g: 160, b: 220 },
  { name: "Golden", r: 200, g: 160, b: 60 },
  { name: "Sunrise", r: 240, g: 140, b: 80 },
  { name: "Rose", r: 180, g: 80, b: 100 },
  { name: "Lavender", r: 140, g: 120, b: 180 },
  { name: "Stone", r: 160, g: 150, b: 140 },
  { name: "Ivory", r: 240, g: 235, b: 220 },
  { name: "Slate", r: 80, g: 90, b: 100 },
  { name: "Emerald", r: 40, g: 120, b: 90 },
];

const MOOD_BY_CATEGORY = {
  nature: "Light",
  traditional: "Classic",
  bold: "Dramatic",
  minimal: "Calm",
  contemporary: "Glow",
  seasonal: "Season",
};

function parseArgs() {
  const source =
    process.argv[2] ?? join(homedir(), "Downloads", "PWPT Themes");
  const outputDir =
    process.argv[3] ?? join(ROOT, "data", "sermon-theme-import");
  const manifestPath = join(ROOT, "data", "pwpt-themes-manifest.json");
  return { source: resolve(source), outputDir: resolve(outputDir), manifestPath };
}

function slugFromFilename(filename) {
  const base = basename(filename, extname(filename))
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "theme";
}

function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return [clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function colorDistance(a, b) {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2,
  );
}

function nearestColorName(r, g, b) {
  let best = COLOR_NAMES[0];
  let bestDist = Infinity;
  for (const c of COLOR_NAMES) {
    const d = colorDistance({ r, g, b }, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.name;
}

function classifyCategory(stats) {
  const { avgR, avgG, avgB, lum, sat } = stats;
  const greenDominant = avgG > avgR + 12 && avgG > avgB + 8;
  const warmStone =
    avgR > 140 &&
    avgG > 120 &&
    avgB < 130 &&
    lum > 0.45 &&
    lum < 0.82;
  const veryDark = lum < 0.28;
  const lightMuted = lum > 0.72 && sat < 0.28;

  if (greenDominant) return "nature";
  if (warmStone) return "traditional";
  if (veryDark) return "bold";
  if (lightMuted) return "minimal";
  return "contemporary";
}

function fontsForCategory(category) {
  if (category === "traditional" || category === "seasonal" || category === "bold") {
    return { font_head: "Georgia", font_body: "Georgia" };
  }
  if (category === "minimal") {
    return { font_head: "Arial", font_body: "Arial" };
  }
  return { font_head: "Calibri", font_body: "Calibri" };
}

function pickTextColor(lum) {
  return lum < 0.5 ? "F8FAFC" : "1C1917";
}

function pickAccentColor(stats, textColor) {
  const darkText = textColor === "1C1917";
  if (darkText) {
    if (stats.avgR > stats.avgB + 20) return "7F1D1D";
    if (stats.avgG > stats.avgR) return "166534";
    return "1E3A5F";
  }
  if (stats.avgR > 120 && stats.avgG > 90) return "FDE68A";
  if (stats.avgG > stats.avgR) return "A7F3D0";
  return "C4B5FD";
}

async function sampleImageStats(filePath) {
  const meta = await sharp(filePath).metadata();
  const width = meta.width ?? MAX_WIDTH;
  const height = meta.height ?? MAX_WIDTH;

  const cropW = Math.round(width * 0.55);
  const cropH = Math.round(height * 0.45);
  const left = Math.round((width - cropW) / 2);
  const top = Math.round((height - cropH) / 2);

  const { data, info } = await sharp(filePath)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(48, 48, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  const pixels = info.width * info.height;

  for (let i = 0; i < data.length; i += info.channels) {
    rSum += data[i];
    gSum += data[i + 1];
    bSum += data[i + 2];
  }

  const avgR = rSum / pixels;
  const avgG = gSum / pixels;
  const avgB = bSum / pixels;
  const lum = luminance(avgR, avgG, avgB);
  const sat = saturation(avgR, avgG, avgB);

  return {
    avgR,
    avgG,
    avgB,
    lum,
    sat,
    bg: rgbToHex(avgR, avgG, avgB),
    colorName: nearestColorName(avgR, avgG, avgB),
  };
}

async function optimizeImage(inputPath, outputPath) {
  let quality = JPEG_QUALITY_START;
  let buffer = await sharp(inputPath)
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (buffer.length > MAX_BYTES && quality > 55) {
    quality -= 5;
    buffer = await sharp(inputPath)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  if (buffer.length > MAX_BYTES) {
    buffer = await sharp(inputPath)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
  }

  writeFileSync(outputPath, buffer);
  return buffer.length;
}

async function main() {
  const { source, outputDir, manifestPath } = parseArgs();

  if (!existsSync(source)) {
    console.error(`Source directory not found: ${source}`);
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const files = readdirSync(source)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .filter((f) => !/\s\(\d+\)\./.test(f))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    console.error(`No images found in ${source}`);
    process.exit(1);
  }

  const usedIds = new Set();
  const manifest = [];
  let sortOrder = 100;

  for (const file of files) {
    const inputPath = join(source, file);
    let id = slugFromFilename(file);
    if (usedIds.has(id)) {
      const suffix = basename(file, extname(file)).match(/\d{5,}/)?.[0];
      id = suffix ? `${id}-${suffix}` : `${id}-${sortOrder}`;
    }
    usedIds.add(id);

    const outputFile = `${id}.jpg`;
    const outputPath = join(outputDir, outputFile);

    process.stdout.write(`Processing ${file}… `);
    const bytes = await optimizeImage(inputPath, outputPath);
    const stats = await sampleImageStats(outputPath);
    const category = classifyCategory(stats);
    const fonts = fontsForCategory(category);
    const textColor = pickTextColor(stats.lum);
    const accentColor = pickAccentColor(stats, textColor);
    const mood = MOOD_BY_CATEGORY[category] ?? "Glow";
    const name = `${stats.colorName} ${mood}`;

    const tags = [
      stats.colorName.toLowerCase(),
      category,
      "photo",
      "scripture",
      "background",
      "photographic",
    ];
    if (stats.lum < 0.35) tags.push("dark");
    if (stats.lum > 0.7) tags.push("light");
    if (stats.sat > 0.35) tags.push("vivid");

    manifest.push({
      id,
      name,
      description: `Photo background — ${stats.colorName.toLowerCase()} ${category} style for scripture slides`,
      category,
      tags: [...new Set(tags)],
      seasonal_tags: [],
      symbol_tags: [],
      visual_style: ["photographic"],
      text_color: textColor,
      accent_color: accentColor,
      bg: stats.bg,
      bg_css: `#${stats.bg}`,
      font_head: fonts.font_head,
      font_body: fonts.font_body,
      italic_ref: category === "traditional",
      text_shadow: true,
      featured: false,
      sort_order: sortOrder,
      file: `./sermon-theme-import/${outputFile}`,
    });

    sortOrder += 1;
    console.log(`✓ ${id} (${(bytes / 1024).toFixed(0)} KB)`);
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${manifest.length} themes to ${manifestPath}`);
  console.log(`Optimized images in ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
