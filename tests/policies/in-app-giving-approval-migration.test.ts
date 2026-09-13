import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Migration 0072's guarantees are about who may *not* write two columns, and a
 * church admin already holds an UPDATE policy on their own church row (0038).
 * That combination is exactly where a later "tidy-up" could quietly reopen the
 * door, so the shape of the guard is pinned here.
 */
const sql = readFileSync("supabase/migrations/0072_in_app_giving_approval.sql", "utf8");

test("every church starts unapproved", () => {
  assert.match(
    sql,
    /add column if not exists apple_pay_donations_approved boolean not null default false/,
  );
  assert.match(sql, /add column if not exists apple_pay_donations_approved_at timestamptz;/);
  // Nothing backfills an approval.
  assert.doesNotMatch(sql, /update public\.churches/i);
});

test("the flag and its date are one fact", () => {
  assert.match(
    sql,
    /check \(apple_pay_donations_approved = \(apple_pay_donations_approved_at is not null\)\)/,
  );
});

test("the browser roles cannot change the approval, on insert or update", () => {
  assert.match(sql, /before insert or update on public\.churches/);
  assert.match(sql, /current_user not in \('anon', 'authenticated'\)/);
  // Both columns are compared, so a date cannot be forged alongside a real flag.
  assert.match(
    sql,
    /new\.apple_pay_donations_approved is distinct from old\.apple_pay_donations_approved/,
  );
  assert.match(
    sql,
    /new\.apple_pay_donations_approved_at is distinct from old\.apple_pay_donations_approved_at/,
  );
  assert.match(sql, /errcode = '42501'/);
});

test("the guard runs as the caller, or it could not tell who the caller is", () => {
  const fn = sql.slice(
    sql.indexOf("create or replace function public.guard_apple_pay_donations_approval"),
    sql.indexOf("drop trigger if exists churches_guard_apple_pay_donations_approval"),
  );
  assert.ok(fn.length > 200, "the guard was renamed and this test went stale");
  // Under SECURITY DEFINER, current_user is the owner and every write passes.
  assert.doesNotMatch(fn.replace(/--.*$/gm, ""), /^\s*security\s+definer\s*$/im);
  assert.match(fn, /set search_path = public/);
});

test("no policy or grant is widened to make this work", () => {
  const code = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /create policy|drop policy|\bgrant\b|disable row level security/i);
});

test("only the platform admin action writes the approval", () => {
  const action = readFileSync("app/admin/giving-actions.ts", "utf8");
  const setter = action.slice(
    action.indexOf("export async function setChurchApplePayDonationsApproval"),
    action.indexOf("export async function openStripeDashboardForChurch"),
  );
  assert.ok(setter.length > 200, "the admin action was renamed and this test went stale");
  assert.match(setter, /await requireSuperAdmin\(\)/);
  assert.match(setter, /createAdminClient\(\)/);
  // Stamped and cleared in the same write, as the check constraint requires.
  assert.match(setter, /apple_pay_donations_approved: approved/);
  assert.match(setter, /apple_pay_donations_approved_at: approvedAt/);
  assert.match(setter, /logAdminAction/);

  // And nothing a church holds mentions the column at all.
  for (const churchSide of [
    "app/dashboard/settings/giving-actions.ts",
    "app/dashboard/website/actions.ts",
    "app/setup/actions.ts",
  ]) {
    assert.ok(
      !readFileSync(churchSide, "utf8").includes("apple_pay_donations_approved"),
      `${churchSide} writes the approval`,
    );
  }
});
