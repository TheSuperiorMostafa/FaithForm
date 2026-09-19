import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { SIGN_IN_DEPENDENTS } from "@/lib/faithform/account-deletion";

import {
  ACCOUNT_OWNED,
  ACCOUNT_REFERENCES,
  AUTH_USER_CASCADES,
  AUTH_USER_OWNED,
  KEPT_UNLINKED,
  type Reference,
} from "./account-references";

/**
 * Account deletion is one Supabase Auth delete, and the schema's foreign keys
 * decide everything that follows (see lib/faithform/account-deletion.ts). That
 * makes the foreign keys the product rule, so they are pinned here as data
 * read from the migrations themselves, not as a description of them.
 *
 * A new table that references an account fails this test until someone adds
 * it to account-references.ts, which means deciding, in writing, whether it is
 * the person's data or a church's record.
 */

const MIGRATIONS = "supabase/migrations";
const files = readdirSync(MIGRATIONS)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

/** SQL with `--` comments removed, so prose cannot satisfy or defeat a match. */
const code = (sql: string) => sql.replace(/--.*$/gm, "");

const migration0073 = readFileSync(`${MIGRATIONS}/0073_account_deletion_record.sql`, "utf8");

/**
 * Every `references <target>` in every migration, in apply order, resolved to
 * the table and column it sits on. A later declaration of the same column
 * replaces an earlier one, exactly as applying the migrations would.
 *
 * Throws on a reference it cannot place, so an unfamiliar spelling fails the
 * test instead of being silently left out of it.
 */
function declaredReferences(target: RegExp): { references: Reference[]; total: number } {
  const byColumn = new Map<string, Reference & { raw: string }>();
  let total = 0;

  for (const file of files) {
    const sql = code(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));
    const pattern = new RegExp(
      `references\\s+${target.source}\\s*\\(\\s*id\\s*\\)(\\s+on\\s+delete\\s+(cascade|set\\s+null|restrict|no\\s+action|set\\s+default))?`,
      "gi",
    );

    for (const match of sql.matchAll(pattern)) {
      total += 1;
      const statement = sql.slice(sql.lastIndexOf(";", match.index!) + 1, match.index!);
      const table =
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(statement)?.[1] ??
        /alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(statement)?.[1];
      const column =
        /([a-z_][a-z0-9_]*)\s+uuid\b[^,()]*$/i.exec(statement)?.[1] ??
        /foreign\s+key\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*$/i.exec(statement)?.[1];

      if (!table || !column) {
        throw new Error(`${file}: could not place a reference to ${target.source}`);
      }

      const rawAction = (match[2] ?? "no action").toLowerCase().replace(/\s+/g, " ");
      byColumn.set(`${table}.${column}`, {
        table,
        column,
        action: rawAction as Reference["action"],
        raw: `${file}`,
      });
    }
  }

  return {
    references: [...byColumn.values()].map(({ table, column, action }) => ({ table, column, action })),
    total,
  };
}

const sortRefs = (refs: readonly Reference[]) =>
  [...refs].sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));

// ---------------------------------------------------------------------------
// The classification is what the migrations declare
// ---------------------------------------------------------------------------

test("every table that references an account is classified, and classified correctly", () => {
  const { references, total } = declaredReferences(/public\.visitor_accounts/);
  // Non-vacuity: the parser found the references grep finds.
  assert.ok(total >= ACCOUNT_REFERENCES.length, `only ${total} references parsed`);
  assert.deepEqual(sortRefs(references), sortRefs(ACCOUNT_REFERENCES));
});

test("no reference to an account can block its deletion", () => {
  // RESTRICT or NO ACTION would make the Auth delete fail for every person
  // with a row there, and the failure would surface as a retry loop, not as
  // a missing feature.
  const { references } = declaredReferences(/public\.visitor_accounts/);
  for (const reference of references) {
    assert.ok(
      reference.action === "cascade" || reference.action === "set null",
      `${reference.table}.${reference.column} is ${reference.action}`,
    );
  }
});

test("a church's own records are never on the deleted side", () => {
  const owned = new Set(ACCOUNT_OWNED.map((reference) => reference.table));
  for (const churchTable of [
    "members",
    "attendance_facts",
    "attendance_attempts",
    "attendance_corrections",
    "checkin_sessions",
    "giving_donations",
    "giving_donors",
    "visitor_invitations",
    "visitor_people_link_events",
    "visitor_account_requests",
  ]) {
    assert.ok(!owned.has(churchTable), `${churchTable} would be deleted with an account`);
  }
  assert.ok(KEPT_UNLINKED.every((reference) => reference.action === "set null"));
});

test("the cascade stops at the account's own tables", () => {
  // One level down: a table that cascades from an account-owned row is
  // deleted too, so it has to be account-owned itself. Everything else that
  // points at those rows (the relationship and People link audit, delivery
  // attempts) must only lose the pointer.
  const owned = new Set(ACCOUNT_OWNED.map((reference) => reference.table));
  let checked = 0;
  for (const table of owned) {
    const { references } = declaredReferences(new RegExp(`public\\.${table}`));
    for (const reference of references) {
      checked += 1;
      assert.ok(
        reference.action === "set null" || owned.has(reference.table),
        `${reference.table}.${reference.column} cascades from ${table}, so deleting an account deletes it`,
      );
    }
  }
  // Non-vacuity: link events, relationship events, claims and delivery
  // attempts all point at account-owned rows.
  assert.ok(checked >= 4, `only ${checked} second-level references found`);
});

test("deleting an Auth user removes the app account, and only staff access and church records besides", () => {
  const { references } = declaredReferences(/auth\.users/);
  const cascades = references.filter((reference) => reference.action === "cascade");
  // Two kinds of cascade, classified separately on purpose: the ones that
  // keep a sign-in alive (staff access, church records) and the person's own
  // messaging data, which goes with them and keeps nothing alive.
  assert.deepEqual(sortRefs(cascades), sortRefs([...AUTH_USER_CASCADES, ...AUTH_USER_OWNED]));
  const keepers = new Set(AUTH_USER_CASCADES.map((reference) => `${reference.table}.${reference.column}`));
  for (const owned of AUTH_USER_OWNED) {
    assert.ok(!keepers.has(`${owned.table}.${owned.column}`), `${owned.table} is in both lists`);
    assert.ok(
      owned.table.startsWith("messaging_") || owned.table === "group_staff_reads",
      `${owned.table} is not messaging data; decide whether it keeps a sign-in alive`,
    );
  }
});

test("the deletion job checks every table an Auth delete would reach, before deleting", () => {
  // If this fails, a migration added a table that cascades from auth.users,
  // and deleting a person's Auth user would now delete their rows there too.
  // Add it to SIGN_IN_DEPENDENTS so a row there keeps the sign-in or, if it is
  // really app-account data, reference visitor_accounts instead.
  const dependents = AUTH_USER_CASCADES.filter((reference) => reference.table !== "visitor_accounts")
    .map(({ table, column }) => ({ table, column }));
  assert.deepEqual(
    sortRefs(SIGN_IN_DEPENDENTS.map(({ table, column }) => ({ table, column, action: "cascade" as const }))),
    sortRefs(dependents.map((dependent) => ({ ...dependent, action: "cascade" as const }))),
  );
});

test("no reference to an Auth user can block deleting it", () => {
  const { references, total } = declaredReferences(/auth\.users/);
  assert.ok(total > 20, `only ${total} auth.users references parsed`);
  for (const reference of references) {
    assert.ok(
      reference.action === "cascade" || reference.action === "set null",
      `${reference.table}.${reference.column} is ${reference.action}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Migration 0073
// ---------------------------------------------------------------------------

const sql0073 = code(migration0073);

test("the request row survives the account it was about", () => {
  assert.match(
    sql0073,
    /alter table public\.visitor_account_requests\s+alter column account_id drop not null;/,
  );
  assert.match(
    sql0073,
    /add constraint visitor_account_requests_account_id_fkey\s+foreign key \(account_id\) references public\.visitor_accounts \(id\)\s+on delete set null;/,
  );
  // The old CASCADE is removed by what it references, not by a guessed name.
  assert.match(sql0073, /c\.confrelid = 'public\.visitor_accounts'::regclass/);
  assert.match(sql0073, /c\.contype = 'f'/);
});

test("an outcome is recorded only on a deletion, and only as one of the three the code writes", () => {
  const check = /add constraint visitor_account_requests_outcome_check\s+check \(([\s\S]*?)\);/.exec(sql0073)?.[1];
  assert.ok(check, "outcome check constraint missing");
  assert.match(check!, /outcome is null/);
  assert.match(check!, /kind = 'deletion'/);

  const inSql = [...check!.matchAll(/'([a-z_]+)'/g)]
    .map((match) => match[1])
    .filter((value) => value !== "deletion")
    .sort();

  const source = readFileSync("lib/faithform/account-deletion.ts", "utf8");
  const union = /export type DeletionOutcome =([\s\S]*?);/.exec(source)?.[1] ?? "";
  const inCode = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();

  assert.deepEqual(inSql, ["account_already_removed", "auth_user_deleted", "staff_account_retained"]);
  assert.deepEqual(inCode, inSql, "the TypeScript outcomes and the check constraint disagree");
});

test("0073 widens no policy or grant and touches no other table", () => {
  assert.doesNotMatch(sql0073, /create policy|drop policy|\bgrant\b|\brevoke\b|row level security/i);
  const altered = new Set(
    [...sql0073.matchAll(/alter table\s+(?:public\.)?([a-z_]+)/gi)].map((match) => match[1]),
  );
  assert.deepEqual([...altered], ["visitor_account_requests"]);
  assert.doesNotMatch(sql0073, /\b(insert into|update public\.|delete from|drop table)\b/i);
});

test("the mobile contract does not learn about outcomes", () => {
  // Server-side audit only: the apps decode request status, and a new field
  // or status there would be a contract change for two shipped clients.
  const lifecycle = readFileSync("lib/faithform/account-lifecycle.ts", "utf8");
  assert.match(lifecycle, /const REQUEST_COLUMNS = "id, kind, status, requested_at, completed_at";/);
  assert.ok(!readFileSync("lib/mobile/v1/contract.ts", "utf8").includes("staff_account_retained"));
});
