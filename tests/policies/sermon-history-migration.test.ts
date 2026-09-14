import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Migration 0075: sermon history ordered by when it was preached.
 *
 * Static checks that the replacement keeps every privacy property 0068 had —
 * SECURITY DEFINER with a pinned search_path, service-role only, the same
 * publication and relationship filters — and that the service calls the
 * function by the names it now has. The executable ordering and cursor checks
 * are in tests/database/sermon-history.test.ts.
 */

const FILE = "supabase/migrations/0075_sermon_history_order.sql";
const sql = readFileSync(FILE, "utf8");
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function functionBody(name: string): string {
  const start = executable.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const end = executable.indexOf("$$;", start);
  return executable.slice(start, end);
}

test("0075 has its own prefix and sorts after 0068", () => {
  const files = readdirSync("supabase/migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name));
  assert.equal(files.filter((name) => name.startsWith("0075")).length, 1);
  assert.ok(files.includes("0068_faithful_sermon_publication.sql"));
});

test("the old click-ordered archive is dropped, not left beside the new one", () => {
  assert.match(
    executable,
    /drop function if exists public\.mobile_sermon_archive\(\s*text, text, text, timestamptz, uuid, integer\s*\)/,
  );
});

for (const name of ["mobile_sermon_archive", "mobile_sermon_detail"]) {
  test(`${name} stays SECURITY DEFINER, stable, search_path pinned`, () => {
    const body = functionBody(name);
    assert.match(body, /security definer/);
    assert.match(body, /\bstable\b/);
    assert.match(body, /set search_path = public/);
  });

  test(`${name} keeps every publication and relationship filter`, () => {
    const body = functionBody(name);
    assert.match(body, /p_relationship_state is distinct from 'blocked'/);
    assert.match(body, /s\.mobile_visibility <> 'none'/);
    assert.match(body, /s\.mobile_published_at is not null/);
    assert.match(body, /s\.mobile_unpublished_at is null/);
    assert.match(body, /s\.mobile_visibility = 'followers'\s+and p_relationship_state in \('following', 'joined'\)/);
    assert.match(body, /s\.mobile_visibility = 'members'\s+and p_relationship_state = 'joined'/);
    // A series title only from the sermon's own church.
    assert.match(body, /ss\.church_id = s\.church_id/);
    // The manuscript is never selected.
    assert.doesNotMatch(body, /s\.content\b/);
    assert.doesNotMatch(body, /style_notes|model_used/);
  });
}

test("grants are service-role only, on the exact new signatures", () => {
  assert.match(
    executable,
    /revoke all on function public\.mobile_sermon_archive\(\s*text, text, text, date, timestamptz, uuid, integer\s*\) from public, anon, authenticated;/,
  );
  assert.match(
    executable,
    /grant execute on function public\.mobile_sermon_archive\(\s*text, text, text, date, timestamptz, uuid, integer\s*\) to service_role;/,
  );
  assert.match(
    executable,
    /revoke all on function public\.mobile_sermon_detail\(text, text, uuid\)\s+from public, anon, authenticated;/,
  );
  assert.doesNotMatch(executable, /grant [^;]* to (anon|authenticated|public)\b/);
});

test("history is ordered by preached date, then first publish time, with a matching keyset", () => {
  const body = functionBody("mobile_sermon_archive");
  assert.match(
    body,
    /coalesce\(\s*s\.mobile_preached_on,\s*s\.sermon_date,\s*\(s\.mobile_published_at at time zone 'UTC'\)::date\s*\) as sort_date/,
  );
  assert.match(
    body,
    /order by history\.sort_date desc, history\.published_at desc, history\.id desc/,
  );
  assert.match(
    body,
    /\(history\.sort_date, history\.published_at, history\.id\)\s*<\s*\(p_cursor_preached, p_cursor_published, p_cursor_id\)/,
  );
});

test("the page cap leaves room for the one-row overfetch at the largest page", () => {
  const body = functionBody("mobile_sermon_archive");
  assert.match(body, /limit greatest\(1, least\(51, p_limit\)\)/);
  const protocol = readFileSync("lib/mobile/v1/protocol.ts", "utf8");
  assert.match(protocol, /export const MAX_PAGE_LIMIT = 50;/);
});

test("the service calls the archive with exactly the parameters 0075 declares", () => {
  const signature = executable.slice(
    executable.indexOf("create or replace function public.mobile_sermon_archive("),
    executable.indexOf("returns table", executable.indexOf("create or replace function public.mobile_sermon_archive(")),
  );
  const declared = [...signature.matchAll(/\b(p_[a-z_]+)\b/g)].map((match) => match[1]).sort();

  const service = readFileSync("lib/sermons/v1/sermon-service.ts", "utf8");
  const call = service.slice(
    service.indexOf('admin.rpc("mobile_sermon_archive"'),
    service.indexOf("}),", service.indexOf('admin.rpc("mobile_sermon_archive"')),
  );
  const passed = [...call.matchAll(/\b(p_[a-z_]+):/g)].map((match) => match[1]).sort();

  assert.deepEqual(passed, declared);
});

test("the service reports a failed projection as unavailable, never as an empty list", () => {
  const service = readFileSync("lib/sermons/v1/sermon-service.ts", "utf8");
  for (const rpc of ["mobile_sermon_archive", "mobile_sermon_detail", "mobile_sermon_version"]) {
    const at = service.indexOf(`admin.rpc("${rpc}"`);
    assert.ok(at >= 0, rpc);
    const after = service.slice(at, at + 700);
    assert.match(after, /if \(error\) unavailable\(/, `${rpc} error is not swallowed`);
  }
  assert.match(service, /new VisitorError\("unavailable"/);
});
