import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { customCssWrite } from "@/lib/sites/design-write";

test("ordinary theme and colour saves preserve existing privileged CSS when omitted or unchanged", () => {
  const current = ".site-hero { padding-top: 42px; }";
  assert.deepEqual(customCssWrite({ requested: undefined, current, platformAdmin: false }), { ok: true, patch: {} });
  assert.deepEqual(customCssWrite({ requested: current, current, platformAdmin: false }), { ok: true, patch: {} });
  assert.deepEqual(customCssWrite({ requested: "", current: null, platformAdmin: false }), { ok: true, patch: {} });
});

test("church admins cannot introduce, replace, or clear platform CSS", () => {
  for (const [requested, current] of [["body{color:red}", null], ["body{color:red}", "body{color:blue}"], ["", "body{color:blue}"]] as const) {
    assert.deepEqual(customCssWrite({ requested, current, platformAdmin: false }), { ok: false });
  }
});

test("platform admins can update or explicitly clear CSS; omission preserves it", () => {
  assert.deepEqual(customCssWrite({ requested: "body{color:red}", current: null, platformAdmin: true }), { ok: true, patch: { custom_css: "body{color:red}" } });
  assert.deepEqual(customCssWrite({ requested: "", current: "body{color:red}", platformAdmin: true }), { ok: true, patch: { custom_css: null } });
  assert.deepEqual(customCssWrite({ requested: undefined, current: "body{color:red}", platformAdmin: true }), { ok: true, patch: {} });
});

test("the design server action checks platform authority and applies only the authorized CSS patch", () => {
  const source = readFileSync("app/dashboard/website/actions.ts", "utf8");
  const action = source.split("export async function saveDesign(")[1].split("export async function setLayoutMode(")[0];
  assert.match(action, /isPlatformAdminUserId\(auth.userId\)/);
  assert.match(action, /\.select\("custom_css"\)\.eq\("church_id", auth.churchId\)/);
  assert.match(action, /if \(!css.ok\) return fail/);
  assert.match(action, /\.\.\.css.patch/);
  assert.doesNotMatch(action, /custom_css: sanitizeCustomCss/);
});
