import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { claimResolutionSchema } from "../../lib/faithform/schemas";
import type { VisitorResult } from "../../lib/faithform/errors";

type Action = { approvePeopleClaim: (input: unknown) => Promise<VisitorResult<null>> };
type Staff = { churchId: string; userId: string; isAdmin: boolean };
const churchId = "11111111-1111-4111-8111-111111111111";
const staffUserId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const claimId = "44444444-4444-4444-8444-444444444444";
const memberId = "12345678-1234-1234-1234-123456789abc"; // Valid PostgreSQL uuid; not RFC variant bits.
const linkId = "55555555-5555-4555-8555-555555555555";
const context: { auth: Staff | null; featureError: string | null; revalidated: string[] } = { auth: null, featureError: null, revalidated: [] };
Object.assign(globalThis, { __peopleClaimTest: context });
const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
type PluginBuild = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }) => void;
};
const { build } = tsxRequire("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };
let compiled: Promise<Action> | null = null;
function action(): Promise<Action> {
  compiled ??= (async () => {
    const path = fileURLToPath(new URL("../../app/dashboard/people/claim-actions.ts", import.meta.url));
    const built = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", target: "node20", tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)), plugins: [{ name: "people-claim-auth", setup(builder: PluginBuild) {
      builder.onResolve({ filter: /^(?:@\/lib\/(?:auth\/church|features\/guard)|next\/cache)$/ }, args => args.importer === path ? { path: args.path, namespace: "people-test" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "people-test" }, args => ({ loader: "js", contents: args.path === "next/cache"
        ? 'export function revalidatePath(path){globalThis.__peopleClaimTest.revalidated.push(path)}'
        : args.path.endsWith("auth/church")
          ? 'export async function getChurchAuth(){return globalThis.__peopleClaimTest.auth}'
          : 'export async function featureActionError(){return globalThis.__peopleClaimTest.featureError}' }));
    } }] });
    const compiledModule = { exports: {} as Action };
    new Function("require", "module", "exports", built.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  })();
  return compiled;
}

function scenario(t: TestContext) {
  context.auth = { churchId, userId: staffUserId, isAdmin: true };
  context.featureError = null;
  context.revalidated = [];
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://people-claims.example.test", SUPABASE_SECRET_KEY: "safe-test-key" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const state = {
    claimChurch: churchId, memberChurch: churchId, claimId, memberId,
    claimStatus: "pending", resolvedMemberId: null as string | null,
    accountStatus: "active", relationship: "joined", activeLink: null as { id: string; account_id: string } | null,
    insertCount: 0, statusWrites: 0, auditCount: 0, authorizationVersion: 1,
    failStatusOnce: false, failAuditOnce: false, failMemberRead: false,
    requests: [] as { url: URL; method: string; body: Record<string, unknown> | null }[],
  };
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, "people-claims.example.test");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    state.requests.push({ url, method, body });
    const table = url.pathname.split("/").at(-1);
    switch (table) {
      case "visitor_people_claims":
        assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
        if (method === "GET") return Response.json(state.claimChurch === churchId ? { id: state.claimId, account_id: accountId, church_id: state.claimChurch, status: state.claimStatus, resolved_member_id: state.resolvedMemberId } : null);
        if (state.failStatusOnce) { state.failStatusOnce = false; return Response.json({ message: "status write failed" }, { status: 400 }); }
        state.statusWrites++;
        state.claimStatus = String(body?.status);
        state.resolvedMemberId = String(body?.resolved_member_id);
        return Response.json({ id: state.claimId });
      case "visitor_accounts":
        if (method === "PATCH") { state.authorizationVersion = Number(body?.authorization_version); return Response.json(null); }
        return Response.json(url.searchParams.get("select")?.includes("authorization_version") ? { authorization_version: state.authorizationVersion } : { id: accountId, status: state.accountStatus });
      case "visitor_church_relationships":
        assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
        return Response.json({ state: state.relationship });
      case "members":
        assert.equal(url.searchParams.get("id"), `eq.${state.memberId}`);
        assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
        if (state.failMemberRead) return Response.json({ message: "private database detail" }, { status: 400 });
        return Response.json(state.memberChurch === churchId ? { id: state.memberId } : null);
      case "visitor_people_links":
        if (method === "GET") {
          assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
          return Response.json(state.activeLink);
        }
        assert.equal(body?.church_id, churchId);
        assert.equal(body?.account_id, accountId);
        assert.equal(body?.member_id, state.memberId);
        assert.equal(body?.linked_by, staffUserId);
        state.insertCount++;
        state.activeLink = { id: linkId, account_id: accountId };
        return Response.json(state.activeLink);
      case "visitor_people_link_events":
        if (method === "GET") return Response.json(state.auditCount ? { id: "existing-audit" } : null);
        if (state.failAuditOnce) { state.failAuditOnce = false; return Response.json({ message: "audit failed" }, { status: 400 }); }
        state.auditCount++;
        return Response.json(null);
      default: throw new Error(`Unexpected query ${url}`);
    }
  });
  return state;
}

const approve = async (input: unknown = { claimId, memberId }) => (await action()).approvePeopleClaim(input);

test("the selected legacy PostgreSQL person id reaches the verified link instead of 'Choose the person'", async t => {
  const state = scenario(t);
  assert.equal(claimResolutionSchema.safeParse({ claimId, memberId }).success, true);
  const result = await approve();
  assert.equal(result.ok, true);
  assert.equal(state.insertCount, 1);
  assert.equal(state.claimStatus, "approved");
  assert.equal(state.resolvedMemberId, memberId);
  assert.equal(state.auditCount, 1);
  assert.equal(state.authorizationVersion, 2);
  assert.ok(context.revalidated.includes("/dashboard/people"));
});

test("UUIDv7, nil and legacy UUID forms are validated as identifiers, then still checked for ownership", async t => {
  const state = scenario(t);
  for (const id of ["01890f12-1234-7def-8123-123456789abc", "00000000-0000-0000-0000-000000000000", memberId]) {
    assert.equal(claimResolutionSchema.safeParse({ claimId: id, memberId: id }).success, true);
  }
  state.memberId = "00000000-0000-0000-0000-000000000000";
  state.memberChurch = "other-church";
  const result = await approve({ claimId, memberId: state.memberId });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /not in this church/);
  assert.equal(state.insertCount, 0);
});

test("bad request ids, missing selections, malformed person ids and notes have distinct recovery messages", async t => {
  const state = scenario(t);
  for (const [input, message] of [
    [{ claimId: "broken", memberId }, /confirmation request/],
    [{ claimId }, /Choose the person/],
    [{ claimId, memberId: "broken" }, /person could not be read/],
    [{ claimId, memberId, note: "x".repeat(501) }, /note/],
    [null, /confirmation request/],
  ] as const) {
    const result = await approve(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, message);
  }
  assert.equal(state.requests.length, 0);
});

test("staff authentication, feature access and church admin remain required", async t => {
  const state = scenario(t);
  context.auth = null;
  assert.equal((await approve()).ok, false);
  context.auth = { churchId, userId: staffUserId, isAdmin: false };
  assert.equal((await approve()).ok, false);
  context.auth.isAdmin = true;
  context.featureError = "People is not enabled.";
  assert.equal((await approve()).ok, false);
  assert.equal(state.requests.length, 0);
});

test("a foreign claim or foreign person cannot be linked", async t => {
  const state = scenario(t);
  state.claimChurch = "other-church";
  assert.equal((await approve()).ok, false);
  state.claimChurch = churchId;
  state.memberChurch = "other-church";
  assert.equal((await approve()).ok, false);
  assert.equal(state.insertCount, 0);
});

test("blocked, left, inactive and already-claimed accounts fail closed", async t => {
  const state = scenario(t);
  state.relationship = "blocked";
  assert.equal((await approve()).ok, false);
  state.relationship = "left";
  assert.equal((await approve()).ok, false);
  state.relationship = "joined";
  state.accountStatus = "deleted";
  assert.equal((await approve()).ok, false);
  state.accountStatus = "active";
  state.activeLink = { id: linkId, account_id: "another-account" };
  assert.equal((await approve()).ok, false);
  assert.equal(state.insertCount, 0);
});

test("a partial status failure is reported and retry finishes the existing exact link", async t => {
  const state = scenario(t);
  state.failStatusOnce = true;
  const first = await approve();
  assert.equal(first.ok, false);
  if (!first.ok) assert.match(first.message, /connection was saved/);
  assert.equal(state.insertCount, 1);
  assert.equal((await approve()).ok, true);
  assert.equal(state.insertCount, 1);
  assert.equal(state.claimStatus, "approved");
  assert.equal(state.auditCount, 1);
});

test("an audit failure can be retried without duplicate people, links or audit events", async t => {
  const state = scenario(t);
  state.failAuditOnce = true;
  assert.equal((await approve()).ok, false);
  assert.equal(state.claimStatus, "approved");
  assert.equal((await approve()).ok, true);
  assert.equal((await approve()).ok, true);
  assert.equal(state.insertCount, 1);
  assert.equal(state.statusWrites, 1);
  assert.equal(state.auditCount, 1);
});

test("replaying an approved claim cannot recreate a revoked connection", async t => {
  const state = scenario(t);
  state.claimStatus = "approved";
  state.resolvedMemberId = memberId;
  assert.equal((await approve()).ok, false);
  assert.equal(state.insertCount, 0);
});

test("a failed ownership lookup reports a retryable error rather than a missing selection", async t => {
  const state = scenario(t);
  state.failMemberRead = true;
  const result = await approve();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /couldn't check this person/);
    assert.doesNotMatch(result.message, /private database detail|Choose the person/);
  }
  assert.equal(state.insertCount, 0);
});
