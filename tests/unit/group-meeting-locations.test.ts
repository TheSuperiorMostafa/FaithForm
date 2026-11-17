import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { loadStaffGroup } from "@/lib/groups/staff/context";
import { formatAddressLine } from "@/lib/utils/address";

function compile(path: string, providers: Record<string, unknown>, extra = "") {
  const localRequire = createRequire(resolve(path));
  const source = ts.transpileModule(readFileSync(path, "utf8") + extra, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const result = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)((name: string) => providers[name] ?? localRequire(name), result, result.exports);
  return result.exports;
}

const churchId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const otherGroupId = "33333333-3333-4333-8333-333333333333";
type Locations = {
  searchGroupMeetingLocations: (groupId: string, query: string, token?: string) => Promise<{ ok: boolean; suggestions?: unknown[]; addressSearch?: string; error?: string }>;
  resolveGroupMeetingLocation: (groupId: string, placeId: string, token?: string) => Promise<{ ok: boolean; value?: string; error?: string }>;
  getGroupMeetingChurchAddress: (groupId: string) => Promise<{ ok: boolean; value?: string; error?: string }>;
};

function scenario() {
  const state = { denied: false, foreignChurch: false, providerFailed: false, requests: [] as string[], searches: [] as unknown[], resolutions: [] as unknown[] };
  const admin = {
    from(table: string) {
      state.requests.push(table);
      assert.ok(table === "groups" || table === "churches", "meeting searches must never expose the saved Announcements location library");
      const filters: Record<string, unknown> = {};
      const builder = {
        select() { return builder; }, eq(key: string, value: unknown) { filters[key] = value; return builder; }, neq() { return builder; },
        async maybeSingle() {
          if (table === "groups") return { data: filters.id === groupId && filters.church_id === churchId && !state.foreignChurch ? { id: groupId, status: "active" } : null, error: null };
          assert.equal(filters.id, churchId);
          return { data: { name: "Riverside Church", address: "123 Example Road", city: "Springfield", state: "KY", zip: "40000" }, error: null };
        },
      };
      return builder;
    },
  };
  const ctx = { churchId, admin };
  const actions = compile("app/dashboard/groups/location-actions.ts", {
    "@/lib/groups/staff/context": { requireGroupsStaff: async () => { if (state.denied) throw new Error("private permission detail"); return ctx; }, loadStaffGroup },
    "@/lib/utils/address": { formatAddressLine },
    "@/lib/announcements/place-suggestions": {
      searchPlaceSuggestions: async (query: string, token: string) => {
        state.searches.push({ query, token });
        if (state.providerFailed) throw new Error("private provider detail");
        return { status: "ready", suggestions: [{ source: "google", label: "Example Hall", value: "Example Hall, 123 Example Road", placeId: "safe-place-id" }] };
      },
      resolvePlaceAddress: async (placeId: string, token: string) => {
        state.resolutions.push({ placeId, token });
        if (state.providerFailed) throw new Error("private provider detail");
        return { ok: true, value: "Example Hall, 123 Example Road, Springfield, KY 40000" };
      },
    },
  }) as Locations;
  return { state, actions };
}

test("group meeting address lookup uses the Groups staff gate, resolves full addresses and forwards the search session", async () => {
  const { state, actions } = scenario();
  const search = await actions.searchGroupMeetingLocations(groupId, "Example Hall", "session-1");
  assert.equal(search.ok, true); assert.equal(search.addressSearch, "ready");
  assert.equal(search.suggestions?.length, 1);
  assert.deepEqual(state.searches, [{ query: "Example Hall", token: "session-1" }]);
  assert.deepEqual(await actions.resolveGroupMeetingLocation(groupId, "safe-place-id", "session-1"), { ok: true, value: "Example Hall, 123 Example Road, Springfield, KY 40000" });
  assert.deepEqual(state.resolutions, [{ placeId: "safe-place-id", token: "session-1" }]);
  assert.deepEqual(await actions.getGroupMeetingChurchAddress(groupId), { ok: true, value: "Riverside Church, 123 Example Road, Springfield, KY 40000" });
});

test("missing staff access and groups outside the staff church stop before Google or church profile lookup", async () => {
  for (const variant of ["denied", "other-group", "foreign-church"] as const) {
    const { state, actions } = scenario();
    state.denied = variant === "denied"; state.foreignChurch = variant === "foreign-church";
    const target = variant === "other-group" ? otherGroupId : groupId;
    assert.equal((await actions.searchGroupMeetingLocations(target, "Example Hall")).ok, false);
    assert.equal((await actions.resolveGroupMeetingLocation(target, "safe-place-id")).ok, false);
    assert.equal((await actions.getGroupMeetingChurchAddress(target)).ok, false);
    assert.deepEqual(state.searches, []); assert.deepEqual(state.resolutions, []);
    assert.equal(state.requests.includes("churches"), false);
  }
});

test("short/oversized meeting address searches do not contact Google and failures never leak provider details", async () => {
  const { state, actions } = scenario();
  for (const query of ["ab", "x".repeat(201)]) {
    assert.deepEqual(await actions.searchGroupMeetingLocations(groupId, query), { ok: true, suggestions: [], addressSearch: "ready" });
  }
  assert.deepEqual(state.searches, []);
  state.providerFailed = true;
  for (const result of [await actions.searchGroupMeetingLocations(groupId, "Example Hall"), await actions.resolveGroupMeetingLocation(groupId, "safe-place-id")]) {
    assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private provider detail/);
  }
});

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

test("the actual meeting form labels its address picker Location and saves the selected address while preserving untouched details", async t => {
  let cursor = 0; const cells: { value: unknown }[] = [], submissions: Record<string, unknown>[] = [], pending: Promise<unknown>[] = [];
  const react = {
    useState(initial: unknown) { const cell = cells[cursor++] ??= { value: initial }; return [cell.value, (value: unknown) => { cell.value = value; }]; },
    useMemo(run: () => unknown) { return run(); },
  };
  const placeholder = new Proxy({}, { get: (_target, key) => String(key) });
  const localRequire = createRequire(resolve("components/groups/gatherings.tsx"));
  const providers = new Proxy({
    react,
    "./shared": { ...placeholder, Field: "Field", Submit: "Submit", useGroupAction: () => ({ pending: false, error: null, run: (fn: () => Promise<unknown>) => { pending.push(fn()); } }) },
    "@/app/dashboard/groups/actions": { saveGathering: async (_group: string, _event: string | null, values: Record<string, unknown>) => { submissions.push(values); return { ok: true, data: {} }; } },
    "@/app/dashboard/groups/location-actions": { searchGroupMeetingLocations: async () => ({ ok: true, suggestions: [], addressSearch: "ready" }), resolveGroupMeetingLocation: async () => ({ ok: true, value: "Selected address" }), getGroupMeetingChurchAddress: async () => ({ ok: true, value: "Church address" }) },
  } as Record<string, unknown>, { get: (object, name: string) => object[name] ?? (name.startsWith("@/components/") || name === "lucide-react" ? placeholder : localRequire(name)) });
  const Form = compile("components/groups/gatherings.tsx", providers, "\nexport { GatheringForm as TestForm };\n").TestForm as (props: Record<string, unknown>) => unknown;
  const existing = { event: { id: "meeting-1", locationName: "Old meeting hall" }, locationAddress: "456 Existing Road" };
  const render = () => { cursor = 0; return elements(Form({ groupId, timezone: "America/New_York", close() {}, existing })); };
  class TestFormData {
    get(name: string) { return ({ title: "Meeting", description: "Notes", starts: "2026-11-20T18:00", ends: "2026-11-20T19:00", url: "https://example.invalid/meeting" } as Record<string, string>)[name] ?? null; }
  }
  const originalFormData = globalThis.FormData;
  globalThis.FormData = TestFormData as unknown as typeof FormData;
  t.after(() => { globalThis.FormData = originalFormData; });
  let tree = render();
  let picker = tree.find(element => element.type === "EventLocationField")!;
  assert.equal(picker.props.name, "location"); assert.equal(picker.props.maxLength, 200);
  assert.ok(tree.some(element => element.type === "Label" && element.props.htmlFor === picker.props.id));
  const submit = async () => { (tree.find(element => element.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault() {}, currentTarget: {} }); await Promise.all(pending.splice(0)); };
  await submit();
  assert.equal(submissions[0].locationName, "Old meeting hall"); assert.equal(submissions[0].locationAddress, "456 Existing Road");
  (picker.props.onChange as (value: string) => void)("  123 Selected Road, Springfield, KY 40000  ");
  tree = render(); picker = tree.find(element => element.type === "EventLocationField")!;
  assert.equal(picker.props.value, "  123 Selected Road, Springfield, KY 40000  ");
  await submit();
  assert.equal(submissions[1].locationName, "123 Selected Road, Springfield, KY 40000");
  assert.equal(submissions[1].locationAddress, null, "the previous physical address must not remain attached to a new location");
  assert.equal(submissions[1].onlineMeetingUrl, "https://example.invalid/meeting");
});
