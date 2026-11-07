import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("app/dashboard/people/actions.ts", "utf8");
const body = (name: string) => source.slice(source.indexOf(`export async function ${name}(`)).split(/\nexport async function /)[0];

test("basic People writes accept the People grant but still require authenticated church authorization", () => {
  for (const name of ["createMember", "updateMember"]) {
    assert.match(body(name), /requireMemberAction\("people", false\)/);
  }
  const guard = source.slice(source.indexOf("async function requireMemberAction("), source.indexOf("/** Shared body."));
  assert.match(guard, /await getChurchAuth\(\)/);
  assert.match(guard, /if \(!auth\)/);
  assert.match(guard, /await featureActionError\(feature\)/);
  assert.ok(guard.indexOf("if (featureError)") < guard.indexOf("createAdminClient()"));
  assert.match(body("updateMember"), /\.eq\("church_id", context.churchId\)/);
  assert.match(source, /church_id: context.churchId/);
});

test("destructive and Attendance-only actions retain the admin check", () => {
  for (const name of ["deactivateMember", "reactivateMember"]) {
    assert.match(body(name), /requireMemberAction\("people"\)/);
    assert.match(body(name), /\.eq\("church_id", context.churchId\)/);
  }
  assert.match(body("createMemberDuringAttendance"), /requireMemberAction\("attendance"\)/);
  assert.match(source, /adminOnly = true/);
  assert.match(source, /if \(adminOnly && !auth.isAdmin\)/);
});
