import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 0180 adds the shared song catalog. What must hold, read from the SQL:
 * the catalog has no lyrics or chart column; full text can only sit in the
 * separate public-domain table, tied to a verified public-domain catalog row;
 * that table ships empty; browsers can only read; church songs keep their RLS.
 */
const sql = readFileSync("supabase/migrations/0180_song_catalog.sql", "utf8");
const code = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function tableBody(name: string): string {
  const start = code.search(new RegExp(`create table if not exists public\\.${name} \\(`));
  assert.ok(start >= 0, `${name} is created`);
  const end = code.indexOf("\n);", start);
  return code.slice(start, end);
}

test("the catalog stores facts only: no lyrics, chart or text column", () => {
  const catalog = tableBody("song_catalog");
  assert.doesNotMatch(catalog, /\b(lyrics|chart_text|chart|words|text_body)\s+text\b/i);
  for (const column of ["ccli_number", "title", "author", "copyright", "themes", "default_key", "tempo"]) {
    assert.match(catalog, new RegExp(`\\b${column}\\b`), `catalog has ${column}`);
  }
  assert.match(catalog, /constraint song_catalog_ccli_key unique \(ccli_number\)/);
  assert.match(catalog, /check \(ccli_number is not null or is_public_domain\)/);
});

test("public-domain text needs a verified public-domain catalog row", () => {
  const catalog = tableBody("song_catalog");
  assert.match(catalog, /not is_public_domain\s+or \(public_domain_verified_at is not null and/);
  const texts = tableBody("song_catalog_public_domain_texts");
  assert.match(texts, /check \(is_public_domain\)/);
  assert.match(texts, /foreign key \(catalog_id, is_public_domain\)\s+references public\.song_catalog \(id, is_public_domain\)/);
  // Ships empty: no seeded text anywhere in the file.
  assert.doesNotMatch(code, /insert\s+into\s+public\.song_catalog_public_domain_texts/i);
});

test("browsers read only; the service role writes; idempotent objects", () => {
  for (const table of ["song_catalog", "song_catalog_public_domain_texts"]) {
    assert.match(code, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(code, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(code, new RegExp(`grant select on table public\\.${table} to authenticated`));
    assert.doesNotMatch(code, new RegExp(`grant[^;]*(insert|update|delete)[^;]*public\\.${table}[^;]*to (authenticated|anon)`));
  }
  assert.doesNotMatch(code, /\bgrant\b[^;]*\banon\b/i);
  assert.doesNotMatch(code, /create table (?!if not exists)/i);
  assert.doesNotMatch(code, /create (unique )?index (?!if not exists)/i);
  assert.match(code, /add column if not exists catalog_id uuid references public\.song_catalog \(id\) on delete set null/);
  // Church songs keep the RLS 0175 gave them: nothing here touches their policies or grants.
  assert.doesNotMatch(code, /(policy|grant|revoke)[^;]*public\.songs\b/i);
});
