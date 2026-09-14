import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

/**
 * Every SECURITY DEFINER helper that a row-level security policy calls must be
 * executable by the role the policy runs as. 0004 and 0053 revoked EXECUTE from
 * `authenticated` on four of them, which left a database built from the
 * migrations unable to open the dashboard ("permission denied for function
 * user_church_ids"); 0077 grants it back. This holds the rule across the whole
 * migration history, so a later revoke has to be answered by a later grant.
 */
const MIGRATIONS = readdirSync("supabase/migrations")
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const executable = (file: string) =>
  readFileSync(`supabase/migrations/${file}`, "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const HELPERS = [
  "user_church_ids()",
  "is_church_admin(uuid)",
  "is_church_staff(uuid)",
  "current_visitor_account_id()",
];

for (const helper of HELPERS) {
  test(`${helper} ends the migration history executable by authenticated`, () => {
    const name = helper.replace(/\(.*$/, "");
    const escaped = helper.replace(/[()]/g, "\\$&");
    let executableByAuthenticated = true;
    let usedByPolicy = false;

    for (const file of MIGRATIONS) {
      const sql = executable(file);
      if (new RegExp(`create\\s+policy[\\s\\S]*?public\\.${name}\\(`, "i").test(sql)) usedByPolicy = true;
      const statements = sql.split(";");
      for (const statement of statements) {
        const s = statement.replace(/\s+/g, " ").toLowerCase();
        if (!s.includes(`public.${helper.toLowerCase()}`)) continue;
        if (/revoke (all|execute) on function/.test(s) && /\bauthenticated\b/.test(s)) executableByAuthenticated = false;
        if (/grant (all|execute) on function/.test(s) && /\bauthenticated\b/.test(s)) executableByAuthenticated = true;
      }
    }

    assert.ok(usedByPolicy, `${helper} is expected to be called from a policy`);
    assert.ok(executableByAuthenticated, `${helper} is revoked from authenticated and never granted back`);
  });
}

test("0077 does not grant the helpers to anon", () => {
  const sql = executable("0077_rls_helper_execute_for_signed_in.sql");
  assert.doesNotMatch(sql, /\banon\b/);
  assert.equal(MIGRATIONS.filter((f) => f.startsWith("0077")).length, 1);
});
