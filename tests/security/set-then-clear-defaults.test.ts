import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Reproduced on the local stack: choosing a main fund whose id did not match
 * (removed in another tab, or another church's) cleared the church's main
 * fund and then set nothing — the church silently lost its choice. The same
 * clear-first shape existed for the primary campus and the default adult room.
 * The target is now proven to be this church's before anything is cleared (or,
 * where no unique index forbids it, set first and the others cleared after).
 */

function body(path: string, marker: string): string {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} in ${path}`);
  return source.slice(start, source.indexOf("\n}\n", start));
}

test("the main fund is set on a live fund of this church before the old one is cleared", () => {
  const fn = body("app/dashboard/settings/giving-actions.ts", "export async function setDefaultFund(");
  const set = fn.indexOf("update({ is_default: true })");
  const clear = fn.indexOf("update({ is_default: false })");
  assert.ok(set > 0 && clear > set, "set first, clear after");
  assert.match(fn, /\.eq\("is_active", true\)\s*\.select\("id"\)/);
  assert.match(fn, /\.neq\("id", fundId\)/);
});

test("renaming or removing a fund that matched nothing is not reported as done", () => {
  for (const marker of ["export async function updateGivingFund(", "export async function deleteGivingFund("]) {
    assert.match(body("app/dashboard/settings/giving-actions.ts", marker), /length === 0\) return \{ error: FUND_NOT_FOUND \}/);
  }
});

test("the primary campus and the adult room are only cleared for a target that exists", () => {
  const campus = body("lib/faithform/campuses.ts", "export async function updateCampus(");
  assert.ok(campus.indexOf('.eq("id", campusId)') < campus.indexOf("clearPrimary(churchId, campusId)"));
  const room = body("app/dashboard/checkin/actions.ts", "export async function setDefaultAdultLocation(");
  assert.ok(room.indexOf("isChurchLocation(") < room.indexOf("is_default_adult_location: false"));
});
