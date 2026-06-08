import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const path = join(__dirname, "../data/slide-themes.json");

const CATEGORIES = new Set([
  "traditional",
  "contemporary",
  "seasonal",
  "minimal",
  "bold",
  "nature",
]);

const HEX = /^[0-9A-Fa-f]{6}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let data;
try {
  data = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`Failed to read ${path}:`, e.message);
  process.exit(1);
}

const errors = [];

if (data.version !== 1) {
  errors.push(`Expected version 1, got ${data.version}`);
}

if (!Array.isArray(data.themes) || data.themes.length === 0) {
  errors.push("themes must be a non-empty array");
  process.exit(1);
}

const ids = new Set();

for (let i = 0; i < data.themes.length; i++) {
  const t = data.themes[i];
  const prefix = `themes[${i}]`;

  if (!t.id || !ID.test(t.id)) {
    errors.push(`${prefix}.id: invalid kebab-case id "${t.id}"`);
  } else if (ids.has(t.id)) {
    errors.push(`${prefix}.id: duplicate id "${t.id}"`);
  } else {
    ids.add(t.id);
  }

  for (const field of ["name", "description", "bg", "bgCss", "text", "accent", "fontHead", "fontBody"]) {
    if (!t[field] || typeof t[field] !== "string") {
      errors.push(`${prefix}.${field}: required string`);
    }
  }

  if (!CATEGORIES.has(t.category)) {
    errors.push(`${prefix}.category: must be one of ${[...CATEGORIES].join(", ")}`);
  }

  if (!Array.isArray(t.tags) || t.tags.length === 0) {
    errors.push(`${prefix}.tags: must be a non-empty array`);
  } else {
    for (const tag of t.tags) {
      if (typeof tag !== "string" || tag !== tag.toLowerCase()) {
        errors.push(`${prefix}.tags: tags must be lowercase strings (got "${tag}")`);
      }
    }
  }

  for (const hexField of ["bg", "text", "accent"]) {
    if (t[hexField] && !HEX.test(t[hexField])) {
      errors.push(`${prefix}.${hexField}: must be 6-char hex without # (got "${t[hexField]}")`);
    }
  }
}

if (errors.length > 0) {
  console.error("Slide theme validation failed:\n");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`Validated ${data.themes.length} slide themes.`);
