import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/0050_security_baseline.sql", "utf8");

test("integration credential table and raw RPC are denied to browsers", () => {
  assert.match(sql, /revoke all on table public\.church_integrations from anon, authenticated/);
  assert.match(
    sql,
    /revoke all on function public\.get_church_integration_tokens\(uuid, text\)[\s\S]+from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.get_church_integration_tokens\(uuid, text\)[\s\S]+to service_role/,
  );
});

test("legacy persistent stream keys are retired once and no longer authorize ingest", () => {
  assert.match(sql, /credential_mode":"capability_v1/);
  assert.match(sql, /access_token = encode\(gen_random_bytes\(32\), 'hex'\)/);
  assert.match(
    sql,
    /metadata ->> 'credential_mode' is distinct from 'capability_v1'/,
  );
});

test("status projection allowlists metadata and omits credential fields", () => {
  const start = sql.indexOf("get_church_integration_status");
  const end = sql.indexOf("-- STORAGE");
  const projection = sql.slice(start, end);
  assert.doesNotMatch(projection, /refresh_token/);
  assert.doesNotMatch(projection, /youtube_url|facebook_url/);
  assert.doesNotMatch(projection, /reconnect_reason/);
  assert.match(projection, /page_name/);
  assert.match(projection, /channel_title/);
});

for (const bucket of ["church-logos", "church-covers", "social-graphics"]) {
  test(`${bucket} writes bind the first path segment to an admin church`, () => {
    const relevant = sql
      .split("create policy")
      .filter((block) => block.includes(bucket) && /insert|update|delete/i.test(block))
      .join("\n");
    assert.match(relevant, /cu\.user_id = auth\.uid\(\)/);
    assert.match(relevant, /cu\.role = 'admin'/);
    assert.match(
      relevant,
      /cu\.church_id::text = \(storage\.foldername\(name\)\)\[1\]/,
    );
  });
}

test("anonymous public chat writes are removed", () => {
  assert.match(sql, /drop policy if exists "stream_chat_public_insert"/);
  assert.match(sql, /revoke insert, update, delete[\s\S]+from anon/);
});

test("atomic limiter is service-role only", () => {
  assert.match(sql, /on conflict \(rate_key\) do update/);
  assert.match(sql, /grant execute on function public\.consume_api_rate_limit[\s\S]+to service_role/);
  assert.match(sql, /revoke all on function public\.consume_api_rate_limit[\s\S]+from public, anon, authenticated/);
});
