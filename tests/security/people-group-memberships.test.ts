import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import ts from "typescript";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberGroupsResult } from "@/app/dashboard/people/group-actions";

const churchId = "11111111-1111-4111-8111-111111111111";
const memberId = "12345678-1234-1234-1234-123456789abc";
const groupId = "22222222-2222-4222-8222-222222222222";

function scenario(t: TestContext) {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://people-groups.example.test"; process.env.SUPABASE_SECRET_KEY = "safe-test-key";
  t.after(() => { if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl; if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey; });
  const state = { auth: { churchId } as { churchId: string } | null, denied: "", ownsMember: true, failed: false, requests: [] as URL[], rows: [] as unknown[] };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "people-groups.example.test"); state.requests.push(url);
    assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
    if (url.pathname.endsWith("/members")) {
      assert.equal(url.searchParams.get("id"), `eq.${memberId}`);
      return Response.json(state.ownsMember ? { id: memberId } : null);
    }
    assert.equal(url.pathname, "/rest/v1/group_memberships");
    assert.equal(url.searchParams.get("member_id"), `eq.${memberId}`);
    assert.equal(url.searchParams.get("status"), "eq.active");
    assert.equal(url.searchParams.get("groups.church_id"), `eq.${churchId}`);
    assert.equal(url.searchParams.get("groups.status"), "neq.deleted");
    return state.failed ? Response.json({ message: "private database detail" }, { status: 500 }) : Response.json(state.rows);
  });
  const path = resolve("app/dashboard/people/group-actions.ts");
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const providers: Record<string, unknown> = {
    "@/lib/auth/church": { getChurchAuth: async () => state.auth },
    "@/lib/features/guard": { featureActionError: async (feature: string) => state.denied === feature ? "Not enabled" : null },
    "@/lib/supabase/admin": { createAdminClient },
  };
  const localRequire = createRequire(path), result = { exports: {} as { getMemberGroups: (id: string) => Promise<MemberGroupsResult> } };
  new Function("require", "module", "exports", code)((name: string) => providers[name] ?? localRequire(name), result, result.exports);
  return { state, read: () => result.exports.getMemberGroups(memberId) };
}

test("person groups use existing active membership facts, preserve names and never include another church or deleted group", async t => {
  const { state, read } = scenario(t);
  const group = { id: groupId, name: "Existing prayer group", status: "active", church_id: churchId };
  state.rows = [{ groups: group }, { groups: [group] }, { groups: { ...group, id: "archived", name: "Earlier group", status: "archived" } }, { groups: { ...group, id: "foreign", church_id: "other" } }, { groups: { ...group, id: "deleted", status: "deleted" } }];
  const result = await read();
  assert.deepEqual(result, { ok: true, available: true, groups: [{ id: "archived", name: "Earlier group", archived: true }, { id: groupId, name: group.name, archived: false }] });
});

test("People and Groups feature checks happen before privileged group reads", async t => {
  const { state, read } = scenario(t);
  state.auth = null; assert.equal((await read()).ok, false);
  state.auth = { churchId }; state.denied = "people"; assert.equal((await read()).ok, false);
  state.denied = "groups"; assert.deepEqual(await read(), { ok: true, available: false, groups: [] });
  assert.equal(state.requests.length, 0);
});

test("a person from another church cannot reveal their groups", async t => {
  const { state, read } = scenario(t); state.ownsMember = false;
  assert.equal((await read()).ok, false);
  assert.equal(state.requests.length, 1);
});

test("a failed group lookup is a recoverable error, not an empty membership list", async t => {
  const { state, read } = scenario(t); state.failed = true;
  const result = await read(); assert.equal(result.ok, false);
  if (!result.ok) { assert.match(result.error, /couldn't load.*groups.*Try again/); assert.doesNotMatch(result.error, /private database detail/); }
});
