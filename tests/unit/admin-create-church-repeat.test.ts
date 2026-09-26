import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Found in the platform admin console on the local stack: a double click on
 * "Create & Send Invite" made two identical churches with an open invite each.
 * A repeat of the same request inside a few minutes now returns the church it
 * already made; a genuinely new church (other name, other invitee, or one that
 * already has staff) is still created.
 */
const source = readFileSync("app/admin/actions.ts", "utf8");

test("createChurch looks for the church this request already made before inserting", () => {
  const body = source.slice(source.indexOf("export async function createChurch("));
  const create = body.slice(0, body.indexOf("\nexport "));
  const lookup = create.indexOf("findRecentlyCreatedChurch(");
  const insert = create.indexOf('.from("churches")\n    .insert(');
  assert.ok(lookup > 0 && insert > 0 && lookup < insert, "the repeat check must come before the insert");
});

test("a repeat means same name, recent, no staff yet, and the same open invite", () => {
  const helper = source.slice(source.indexOf("async function findRecentlyCreatedChurch("));
  const body = helper.slice(0, helper.indexOf("\n}\n"));
  assert.match(body, /\.eq\("name", name\)/);
  assert.match(body, /\.gte\("created_at", since\)/);
  assert.match(body, /church_users \?\? \[\]\)\.length > 0\) continue/);
  assert.match(body, /i\.email === adminEmail && !i\.accepted_at/);
  assert.match(body, /\.eq\("timezone", timezone\)/);
  // Without an invitee there is nothing to tell a repeat from a second church.
  const create = source.slice(source.indexOf("export async function createChurch("));
  assert.match(create, /const repeat = invitingAdmin\s*\?/);
});
