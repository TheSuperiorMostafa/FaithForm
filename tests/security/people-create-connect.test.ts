import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type PeopleActions = Pick<typeof import("@/app/dashboard/people/actions"), "createMember" | "updateMember">;
type ConnectionActions = Pick<typeof import("@/app/dashboard/people/claim-actions"), "addAppMemberToPeople" | "addPeopleClaimAsNewPerson" | "moveAppConnectionToPerson">;
const churchId = "11111111-1111-4111-8111-111111111111";
const staffUserId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const claimId = "44444444-4444-4444-8444-444444444444";
const legacyMemberId = "12345678-1234-1234-1234-123456789abc";
const legacyTargetId = "abcdefab-abcd-abcd-abcd-abcdefabcdef";
const context = {
  auth: { churchId, userId: staffUserId, isAdmin: true } as { churchId: string; userId: string; isAdmin: boolean } | null,
  featureError: null as string | null,
  checkedFeatures: [] as string[], revalidated: [] as string[],
};
Object.assign(globalThis, { __peopleCreateConnectTest: context });

const require = createRequire(import.meta.url);
const tsxRequire = createRequire(require.resolve("tsx/package.json"));
type PluginBuild = {
  onResolve: (options: { filter: RegExp }, callback: (args: { path: string; importer: string }) => { path: string; namespace: string } | undefined) => void;
  onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => { contents: string; loader: string }) => void;
};
const { build } = tsxRequire("esbuild") as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: { text: string }[] }> };
async function loadActions<T>(relativePath: string): Promise<T> {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const result = await build({
    entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", target: "node20",
    tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
    plugins: [{ name: "people-request-context", setup(builder: PluginBuild) {
      builder.onResolve({ filter: /^(?:@\/lib\/(?:auth\/church|features\/guard|supabase\/server)|next\/cache)$/ }, args =>
        args.importer === path ? { path: args.path, namespace: "people-action-test" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "people-action-test" }, args => ({ loader: "js", contents:
        args.path === "next/cache" ? 'export function revalidatePath(path){globalThis.__peopleCreateConnectTest.revalidated.push(path)}'
          : args.path.endsWith("auth/church") ? 'export async function getChurchAuth(){return globalThis.__peopleCreateConnectTest.auth}'
            : args.path.endsWith("features/guard") ? 'export async function featureActionError(feature){globalThis.__peopleCreateConnectTest.checkedFeatures.push(feature);return globalThis.__peopleCreateConnectTest.featureError}'
              : 'export function createClient(){throw new Error("This People action must use its guarded tenant-scoped write path")}',
      }));
    } }],
  });
  const compiled = { exports: {} as T };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiled, compiled.exports);
  return compiled.exports;
}
let people: Promise<PeopleActions> | undefined;
let connections: Promise<ConnectionActions> | undefined;
const peopleActions = () => people ??= loadActions<PeopleActions>("../../app/dashboard/people/actions.ts");
const connectionActions = () => connections ??= loadActions<ConnectionActions>("../../app/dashboard/people/claim-actions.ts");

function scenario(t: TestContext) {
  context.auth = { churchId, userId: staffUserId, isAdmin: true };
  context.featureError = null; context.checkedFeatures = []; context.revalidated = [];
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://people-create-connect.example.test", SUPABASE_SECRET_KEY: "safe-test-key" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const state = {
    requests: [] as { url: URL; method: string; body: Record<string, unknown> }[],
    memberError: false, rpcError: null as string | null, outcome: "linked" as unknown,
  };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "people-create-connect.example.test", "verification must never reach a real database");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    state.requests.push({ url, method: init?.method ?? "GET", body });
    if (url.pathname === "/rest/v1/members") {
      if (state.memberError) return Response.json({ code: "23505", message: "private database detail" }, { status: 400 });
      return Response.json({ id: legacyMemberId, first_name: body.first_name, last_name: body.last_name, phone: body.phone, email: body.email, photo_url: null, is_active: true, membership_status: body.membership_status ?? "visitor" });
    }
    assert.match(url.pathname, /^\/rest\/v1\/rpc\/(connect_app_member|add_people_claim_as_new_person|move_people_link)$/);
    if (state.rpcError) return Response.json({ message: state.rpcError }, { status: 400 });
    return Response.json(url.pathname.endsWith("connect_app_member") ? state.outcome : url.pathname.endsWith("add_people_claim_as_new_person") ? legacyMemberId : null);
  });
  return state;
}

test("Add person executes the real action, normalizes input and takes its church only from the authorized session", async t => {
  const state = scenario(t);
  context.auth!.isAdmin = false; // The explicit People grant permits basic edits.
  const input = { firstName: "  Avery  ", lastName: "  Lee  ", email: " AVERY@example.invalid ", phone: "(859) 555-0100", membershipStatus: "visitor" as const, church_id: "foreign-church", account_id: accountId };
  const result = await (await peopleActions()).createMember(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.member.id, legacyMemberId);
    assert.equal(result.member.first_name, "Avery");
    assert.equal(result.member.email, "avery@example.invalid");
  }
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].method, "POST");
  assert.deepEqual(state.requests[0].body, { church_id: churchId, first_name: "Avery", last_name: "Lee", phone: "+18595550100", email: "avery@example.invalid", membership_status: "visitor", is_active: true });
  assert.deepEqual(context.checkedFeatures, ["people"]);
  assert.deepEqual(context.revalidated, ["/dashboard/people", "/dashboard/attendance"]);
});

test("an unknown last name is stored as empty text and contact details remain absent", async t => {
  const state = scenario(t);
  assert.equal((await (await peopleActions()).createMember({ firstName: "Cher", lastName: "" })).ok, true);
  assert.deepEqual(state.requests[0].body, { church_id: churchId, first_name: "Cher", last_name: "", phone: null, email: null, is_active: true });
});

test("signed-out, disabled People, invalid names/contact details and bad statuses never write a person", async t => {
  const state = scenario(t); const actions = await peopleActions();
  context.auth = null;
  assert.equal((await actions.createMember({ firstName: "Avery", lastName: "Lee" })).ok, false);
  context.auth = { churchId, userId: staffUserId, isAdmin: true }; context.featureError = "People is not enabled.";
  assert.equal((await actions.createMember({ firstName: "Avery", lastName: "Lee" })).ok, false);
  context.featureError = null;
  for (const input of [{ firstName: " ", lastName: "Lee" }, { firstName: "Avery", lastName: "Lee", email: "broken" }, { firstName: "Avery", lastName: "Lee", phone: "broken" }, { firstName: "Avery", lastName: "Lee", membershipStatus: "invalid" as "visitor" }]) {
    assert.equal((await actions.createMember(input)).ok, false);
  }
  assert.equal(state.requests.length, 0);
  assert.equal(context.revalidated.length, 0);
});

test("editing an imported person uses the legacy identifier and an exact authorized church predicate", async t => {
  const state = scenario(t);
  assert.equal((await (await peopleActions()).updateMember({ memberId: legacyMemberId, firstName: "Avery", lastName: "Lee" })).ok, true);
  assert.equal(state.requests[0].method, "PATCH");
  assert.equal(state.requests[0].url.searchParams.get("id"), `eq.${legacyMemberId}`);
  assert.equal(state.requests[0].url.searchParams.get("church_id"), `eq.${churchId}`);
  assert.equal(Object.hasOwn(state.requests[0].body, "church_id"), false);
});

test("a rejected People database write reports failure and does not revalidate as success", async t => {
  const state = scenario(t); state.memberError = true;
  t.mock.method(console, "error", () => {});
  const result = await (await peopleActions()).createMember({ firstName: "Avery", lastName: "Lee" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.doesNotMatch(result.error, /private database detail/);
  assert.equal(context.revalidated.length, 0);
});

test("app connection actions require People admin authorization before any database call", async t => {
  const state = scenario(t); const actions = await connectionActions();
  for (const auth of [null, { churchId, userId: staffUserId, isAdmin: false }]) {
    context.auth = auth;
    assert.equal((await actions.addAppMemberToPeople({ accountId })).ok, false);
    assert.equal((await actions.addPeopleClaimAsNewPerson({ claimId, firstName: "Avery", lastName: "Lee" })).ok, false);
    assert.equal((await actions.moveAppConnectionToPerson({ fromMemberId: legacyMemberId, toMemberId: legacyTargetId })).ok, false);
  }
  context.auth = { churchId, userId: staffUserId, isAdmin: true }; context.featureError = "People is not enabled.";
  assert.equal((await actions.addAppMemberToPeople({ accountId })).ok, false);
  assert.equal(state.requests.length, 0);
});

test("adding an app member calls the canonical RPC and preserves its actual connection outcome", async t => {
  const state = scenario(t); const actions = await connectionActions();
  for (const outcome of ["linked", "already_linked", "awaiting_staff", "not_joined", "account_inactive"] as const) {
    state.outcome = outcome;
    const result = await actions.addAppMemberToPeople({ accountId });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.outcome, outcome);
  }
  for (const request of state.requests) {
    assert.equal(request.url.pathname, "/rest/v1/rpc/connect_app_member");
    assert.deepEqual(request.body, { p_account_id: accountId, p_church_id: churchId, p_actor_user_id: staffUserId });
  }
});

test("adding a claim as someone new and moving an app connection retain legacy IDs and tenant/staff context", async t => {
  const state = scenario(t); const actions = await connectionActions();
  const result = await actions.addPeopleClaimAsNewPerson({ claimId, firstName: "Avery", lastName: "Lee" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.memberId, legacyMemberId);
  assert.equal(state.requests[0].url.pathname, "/rest/v1/rpc/add_people_claim_as_new_person");
  assert.deepEqual(state.requests[0].body, { p_church_id: churchId, p_claim_id: claimId, p_staff_user_id: staffUserId, p_first_name: "Avery", p_last_name: "Lee" });
  assert.equal((await actions.moveAppConnectionToPerson({ fromMemberId: legacyMemberId, toMemberId: legacyTargetId })).ok, true);
  assert.equal(state.requests[1].url.pathname, "/rest/v1/rpc/move_people_link");
  assert.deepEqual(state.requests[1].body, { p_church_id: churchId, p_from_member_id: legacyMemberId, p_to_member_id: legacyTargetId, p_staff_user_id: staffUserId });
});

test("unknown RPC results and refused app connections never report successful linkage", async t => {
  const state = scenario(t); const actions = await connectionActions();
  state.outcome = "invented_outcome";
  assert.equal((await actions.addAppMemberToPeople({ accountId })).ok, false);
  state.rpcError = "member_not_found";
  const result = await actions.moveAppConnectionToPerson({ fromMemberId: legacyMemberId, toMemberId: legacyTargetId });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /not in your People list/);
  assert.equal(context.revalidated.length, 0);
});
