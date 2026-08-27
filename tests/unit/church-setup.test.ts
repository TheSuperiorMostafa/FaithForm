import assert from "node:assert/strict";
import test from "node:test";

import { generateChurchSlug } from "../../lib/churches/slug";

// ---------------------------------------------------------------------------
// The public identifier every church-creation path mints.
// ---------------------------------------------------------------------------

test("a slug is the kebab-cased name plus eight hex characters", () => {
  const slug = generateChurchSlug("Grace Community Church");
  assert.match(slug, /^grace-community-church-[0-9a-f]{8}$/);
});

test("punctuation and case collapse into the same clean base", () => {
  const slug = generateChurchSlug("  St. Mary's — Cathedral!  ");
  assert.match(slug, /^st-mary-s-cathedral-[0-9a-f]{8}$/);
});

test("a name with no usable characters still yields a slug", () => {
  const slug = generateChurchSlug("†✝✝†");
  assert.match(slug, /^church-[0-9a-f]{8}$/);
});

test("two churches with the same name get different slugs", () => {
  const first = generateChurchSlug("First Baptist Church");
  const second = generateChurchSlug("First Baptist Church");
  assert.notEqual(first, second);
});

test("a very long name is truncated before the random suffix", () => {
  const slug = generateChurchSlug("a".repeat(200));
  // 60 chars of base + "-" + 8 hex.
  assert.ok(slug.length <= 69, `slug too long: ${slug.length}`);
  assert.match(slug, /-[0-9a-f]{8}$/);
});
