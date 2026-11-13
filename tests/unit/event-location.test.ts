import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import ts from "typescript";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocationSuggestions, saveLocation } from "@/lib/announcements/location-suggestions";
import { formatAddressLine } from "@/lib/utils/address";
import type { searchPlaceSuggestions as SearchPlaces } from "@/lib/announcements/place-suggestions";
import type * as LocationActions from "@/app/dashboard/announcements/location-actions";

function compile(path: string, providers: Record<string, unknown>) {
  const absolute = resolve(path), localRequire = createRequire(absolute);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const result = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)((name: string) => providers[name] ?? localRequire(name), result, result.exports);
  return result.exports;
}

function scenario(t: TestContext) {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://event-locations.example.test", SUPABASE_SECRET_KEY: "safe-test-key", GOOGLE_PLACES_API_KEY: "safe-places-test-key" };
  for (const [key, value] of Object.entries(env)) { const before = process.env[key]; process.env[key] = value; t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; }); }
  const churchId = "11111111-1111-4111-8111-111111111111";
  const state = { auth: { churchId, userId: "staff" } as { churchId: string; userId: string } | null, denied: false, placesFail: false, savedFail: false, churchFail: false, address: "123 Example Road", requests: [] as { url: URL; init?: RequestInit }[] };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource)); state.requests.push({ url, init });
    if (url.hostname === "places.googleapis.com") {
      assert.equal(url.pathname, "/v1/places:autocomplete");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), env.GOOGLE_PLACES_API_KEY);
      assert.equal(new Headers(init?.headers).get("X-Goog-FieldMask"), "suggestions.placePrediction.text.text");
      assert.equal(url.search, "");
      assert.equal(init?.cache, "no-store");
      assert.deepEqual(JSON.parse(String(init?.body)), { input: "123 Example" });
      return state.placesFail ? Response.json({ error: { message: "private provider detail" } }, { status: 403 }) : Response.json({ suggestions: [{ placePrediction: { text: { text: "123 Example Avenue, Exampletown" } } }] });
    }
    assert.equal(url.hostname, "event-locations.example.test", "tests must never contact the real database");
    if (url.pathname.endsWith("/churches")) {
      assert.equal(url.searchParams.get("id"), `eq.${churchId}`);
      return state.churchFail ? Response.json({ message: "private database detail" }, { status: 400 }) : Response.json({ name: "Test Church", address: state.address, city: "Exampletown", state: "KY", zip: "40000" });
    }
    assert.equal(url.pathname, "/rest/v1/saved_event_locations");
    assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
    return state.savedFail ? Response.json({ message: "private database detail" }, { status: 400 }) : Response.json([{ id: "saved", name: "123 Example Hall", full_address: "123 Example Hall, Exampletown", use_count: 3 }]);
  });
  const places = compile("lib/announcements/place-suggestions.ts", { "server-only": {} }).searchPlaceSuggestions as typeof SearchPlaces;
  const actions = compile("app/dashboard/announcements/location-actions.ts", {
    "@/lib/auth/church": { getChurchAuth: async () => state.auth },
    "@/lib/features/guard": { featureActionError: async () => state.denied ? "Not enabled" : null },
    "@/lib/supabase/admin": { createAdminClient },
    "@/lib/announcements/location-suggestions": { getLocationSuggestions, saveLocation },
    "@/lib/announcements/place-suggestions": { searchPlaceSuggestions: places },
    "@/lib/utils/address": { formatAddressLine },
  }) as typeof LocationActions;
  return { state, actions, places };
}

test("event addresses merge tenant-scoped saved locations with real Places autocomplete HTTP and keep the key server-only", async t => {
  const { state, actions } = scenario(t);
  const result = await actions.searchLocations("123 Example");
  assert.equal(result.ok, true);
  if (result.ok) { assert.ok(result.suggestions.some(s => s.source === "saved")); assert.ok(result.suggestions.some(s => s.source === "google")); assert.equal(result.addressSearch, "ready"); }
  assert.doesNotMatch(JSON.stringify(result), /safe-places-test-key|private provider detail/);
  assert.equal(state.requests.filter(r => r.url.hostname === "places.googleapis.com").length, 1);
});

test("unconfigured or failed Places keeps church/saved suggestions and reports manual recovery", async t => {
  const { state, actions } = scenario(t);
  delete process.env.GOOGLE_PLACES_API_KEY;
  const missing = await actions.searchLocations("123 Example");
  assert.equal(missing.ok, true);
  if (missing.ok) { assert.equal(missing.addressSearch, "unconfigured"); assert.ok(missing.suggestions.length); }
  assert.equal(state.requests.some(r => r.url.hostname === "places.googleapis.com"), false);
  process.env.GOOGLE_PLACES_API_KEY = "safe-places-test-key"; state.placesFail = true;
  const failed = await actions.searchLocations("123 Example");
  assert.equal(failed.ok, true);
  if (failed.ok) { assert.equal(failed.addressSearch, "unavailable"); assert.ok(failed.suggestions.length); }
  assert.doesNotMatch(JSON.stringify(failed), /private provider detail/);
});

test("a failed saved-location query does not suppress working address search or claim a healthy empty library", async t => {
  const { state, actions } = scenario(t); state.savedFail = true;
  const result = await actions.searchLocations("123 Example");
  assert.equal(result.ok, true);
  if (result.ok) { assert.match(result.notice ?? "", /Saved locations couldn't load/); assert.equal(result.suggestions[0].source, "google"); }
});

test("address search and church autofill require authenticated Announcements access before provider or database calls", async t => {
  const { state, actions } = scenario(t);
  state.auth = null;
  assert.equal((await actions.searchLocations("123 Example")).ok, false);
  assert.equal((await actions.getChurchEventLocation()).ok, false);
  assert.equal((await actions.trackLocationUsage("123 Example")).ok, false);
  state.auth = { churchId: "11111111-1111-4111-8111-111111111111", userId: "staff" }; state.denied = true;
  assert.equal((await actions.searchLocations("123 Example")).ok, false);
  assert.equal((await actions.getChurchEventLocation()).ok, false);
  assert.equal(state.requests.length, 0);
});

test("Use church address fills the actual saved profile and explains lookup failures without overwriting it", async t => {
  const { state, actions } = scenario(t);
  assert.deepEqual(await actions.getChurchEventLocation(), { ok: true, value: "Test Church, 123 Example Road, Exampletown, KY 40000" });
  state.churchFail = true;
  const result = await actions.getChurchEventLocation(); assert.equal(result.ok, false);
  if (!result.ok) { assert.match(result.error, /Type it here or try again/); assert.doesNotMatch(result.error, /private database detail/); }
  assert.equal(state.requests.some(r => r.init?.method === "POST" || r.init?.method === "PATCH"), false);
});

type Element = { type: unknown; props: Record<string, unknown> };
function all(node: unknown): Element[] { if (Array.isArray(node)) return node.flatMap(all); if (!node || typeof node !== "object" || !("props" in node)) return []; const element = node as Element; return [element, ...all(element.props.children)]; }
function harness(search: typeof LocationActions.searchLocations) {
  const cells: { value: unknown }[] = [], effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const scheduled: (() => void)[] = []; let cursor = 0, value = ""; const tracked: string[] = [];
  const react = {
    useState(initial: unknown) { const index = cursor++; const cell = cells[index] ??= { value: initial }; return [cell.value, (next: unknown) => { cell.value = typeof next === "function" ? next(cell.value) : next; }]; },
    useEffect(run: () => void | (() => void), deps: unknown[]) { const index = cursor++, previous = effects[index]; if (!previous || !deps.every((dep, i) => Object.is(dep, previous.deps[i]))) { previous?.cleanup?.(); effects[index] = { deps }; scheduled.push(() => { const cleanup = run(); if (typeof cleanup === "function") effects[index].cleanup = cleanup; }); } },
  };
  const Field = compile("components/announcements/event-location-field.tsx", { react, "@/components/ui/button": { Button: "button" }, "@/components/ui/input": { Input: "input" }, "@/components/ui/label": { Label: "label" }, "@/components/ui/skeleton": { SkeletonContainer: "loading", SkeletonText: "skeleton" }, "@/lib/utils/address": { formatAddressLine }, "@/app/dashboard/announcements/location-actions": { searchLocations: search, trackLocationUsage: async (text: string) => { tracked.push(text); return { ok: true }; }, getChurchEventLocation: async () => ({ ok: true, value: "Existing Church, 123 Existing Road" }) } }).EventLocationField as (props: Record<string, unknown>) => unknown;
  let nodes: Element[] = [];
  const render = () => { cursor = 0; nodes = all(Field({ id: "where", value, onChange: (next: string) => { value = next; } })); scheduled.splice(0).forEach(run => run()); return nodes; };
  const input = () => nodes.find(n => n.type === "input" && n.props.id === "where")!;
  const invoke = (node: Element, handler: string, event?: unknown) => (node.props[handler] as (e?: unknown) => unknown)(event);
  return { render, input, invoke, tracked, value: () => value, nodes: () => nodes, change(next: string) { invoke(input(), "onChange", { target: { value: next } }); render(); }, cleanup() { effects.forEach(e => e?.cleanup?.()); } };
}

test("the actual location field debounces searches, ignores stale responses and selects an address by keyboard", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests: { query: string; resolve: (result: Awaited<ReturnType<typeof LocationActions.searchLocations>>) => void }[] = [];
  const h = harness(query => new Promise(resolve => { requests.push({ query, resolve }); })); t.after(h.cleanup);
  h.render(); h.change("Old address"); t.mock.timers.tick(300);
  h.change("Current address"); t.mock.timers.tick(300);
  assert.deepEqual(requests.map(r => r.query), ["Old address", "Current address"]);
  requests[1].resolve({ ok: true, addressSearch: "ready", suggestions: [{ label: "Current", value: "123 Current Road", source: "google" }] });
  await Promise.resolve(); h.render();
  requests[0].resolve({ ok: true, addressSearch: "ready", suggestions: [{ label: "Old", value: "999 Old Road", source: "google" }] });
  await Promise.resolve(); h.render();
  assert.equal(h.nodes().some(n => n.props.children === "999 Old Road"), false);
  const key = (name: string) => h.invoke(h.input(), "onKeyDown", { key: name, preventDefault() {}, stopPropagation() {} });
  key("ArrowDown"); h.render(); assert.equal(h.input().props["aria-activedescendant"], "where-suggestion-0");
  key("Enter"); h.render();
  assert.equal(h.value(), "123 Current Road");
  assert.equal(h.tracked.length, 0, "external predictions must not be silently copied into the saved-location library");
  assert.equal(h.input().props["aria-expanded"], false);
});

test("both event entry points retain manual location editing and the shared field provides church autofill", async t => {
  const h = harness(async () => ({ ok: true, addressSearch: "unconfigured", suggestions: [] })); t.after(h.cleanup);
  h.render();
  const button = h.nodes().find(n => n.type === "button" && n.props.children === "Use church address"); assert.ok(button);
  h.invoke(button, "onClick"); await Promise.resolve(); h.render();
  assert.equal(h.value(), "Existing Church, 123 Existing Road");
  h.change("Manual venue"); assert.equal(h.value(), "Manual venue");
  assert.match(readFileSync("components/announcements/create-event-dialog.tsx", "utf8"), /<EventLocationField id="event-location"/);
  const composer = readFileSync("components/announcements/announcement-composer.tsx", "utf8");
  assert.match(composer, /<EventLocationField/); assert.match(composer, /Use church address/);
});
