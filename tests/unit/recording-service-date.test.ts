import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";
import { formatRecordingDate, isRecordingServiceDate, recordingDateValue } from "@/lib/stream/recording-date";
import { getStaffRecording, updateRecordingDetails } from "@/lib/stream/recording-publication";
import { createRecordingTagsValue, recordingTagItems } from "@/components/media/recording-tags-field";
import type { RecordingReview } from "@/components/live-streaming/recordings/recording-review";

test("service dates accept real Gregorian days and reject rolled dates, malformed payloads and unsupported years", () => {
  for (const value of ["0001-01-01", "2024-02-29", "2000-02-29", "2026-11-08", "9999-12-31"]) assert.equal(isRecordingServiceDate(value), true, value);
  for (const value of [null, undefined, 20261108, {}, "", "2026-2-08", "2026-11-8", "2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01", "10000-01-01", " 2026-11-08", "2026-11-08T00:00:00Z", "infinity"]) {
    assert.equal(isRecordingServiceDate(value), false, String(value));
  }
});

test("the selected service day survives viewer offsets, DST transitions and a later upload day", () => {
  for (const zone of ["America/New_York", "Pacific/Honolulu", "Pacific/Kiritimati", "Asia/Tokyo", "UTC"]) {
    for (const day of ["2026-03-08", "2026-11-01", "2024-02-29"]) {
      assert.equal(recordingDateValue("2026-11-13T03:11:00Z", zone, day), day);
      assert.equal(formatRecordingDate("2026-11-13T03:11:00Z", zone, day), formatRecordingDate("2020-01-01T00:00:00Z", "UTC", day));
    }
  }
  assert.equal(recordingDateValue("2026-11-13T03:11:00Z", "America/New_York"), "2026-11-12");
  assert.equal(recordingDateValue("2026-11-13T03:11:00Z", "Asia/Tokyo", null), "2026-11-13");
  assert.equal(formatRecordingDate("2026-11-13T03:11:00Z", "Pacific/Kiritimati", "2026-11-08", true), "Sunday, November 8, 2026");
});

function database(t: TestContext) {
  const state = { serviceDate: "2026-11-08" as string | null, patches: [] as Record<string, unknown>[], missing: false, fail: false };
  const technical = { recording_started_at: "2026-11-13T03:11:00Z", created_at: "2026-11-13T03:00:00Z" };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "service-date.example.test");
    if (url.pathname.endsWith("/churches")) {
      assert.equal(url.searchParams.get("id"), "eq.church-a");
      return Response.json({ slug: "qa-service-date" });
    }
    assert.ok(url.pathname.endsWith("/stream_recordings"));
    assert.equal(url.searchParams.get("church_id"), "eq.church-a");
    assert.equal(url.searchParams.get("id"), "eq.recording-a");
    assert.equal(url.searchParams.get("deleted_at"), "is.null");
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.patches.push(patch);
      assert.equal("recording_started_at" in patch, false);
      assert.equal("created_at" in patch, false);
      if (state.fail) return Response.json({ code: "XX000", message: "injected save failure" }, { status: 400 });
      if (state.missing) return Response.json([]);
      if ("service_date" in patch) state.serviceDate = patch.service_date as string | null;
      return Response.json([{ id: "recording-a" }]);
    }
    assert.ok(url.searchParams.get("select")?.split(",").map(part => part.trim()).includes("service_date"));
    return Response.json({ id: "recording-a", church_id: "church-a", title: "Sunday", service_date: state.serviceDate, ...technical,
      status: "ready", source_kind: "file", duration_sec: 120, mobile_playable: true, mobile_rendition_verified_at: "2026-11-13T04:00:00Z" });
  });
  return { state, technical, db: createClient("https://service-date.example.test", "safe-test-key", { auth: { persistSession: false, autoRefreshToken: false } }) };
}

test("editing and reloading the service date preserves encoder timestamps; unrelated saves retain the chosen day and null resets it", async t => {
  const { state, db, technical } = database(t);
  assert.equal((await updateRecordingDetails({ churchId: "church-a", recordingId: "recording-a", serviceDate: "2024-02-29" }, db)).ok, true);
  assert.deepEqual(state.patches[0], { service_date: "2024-02-29" });
  const saved = await getStaffRecording("church-a", "recording-a", db);
  assert.equal(saved?.serviceDate, "2024-02-29"); assert.equal(saved?.recordedAt, technical.recording_started_at); assert.equal(saved?.createdAt, technical.created_at);
  assert.equal((await updateRecordingDetails({ churchId: "church-a", recordingId: "recording-a", title: "Changed title" }, db)).ok, true);
  assert.deepEqual(state.patches[1], { title: "Changed title" }); assert.equal(state.serviceDate, "2024-02-29");
  assert.equal((await updateRecordingDetails({ churchId: "church-a", recordingId: "recording-a", serviceDate: null }, db)).ok, true);
  assert.equal((await getStaffRecording("church-a", "recording-a", db))?.serviceDate, null);
});

test("invalid service dates cause no writes; missing tenant-scoped rows and rejected saves never report success", async t => {
  const { state, db } = database(t);
  for (const serviceDate of ["2026-02-29", "2026-04-31", "", 42, { date: "2026-11-08" }]) {
    assert.equal((await updateRecordingDetails({ churchId: "church-a", recordingId: "recording-a", title: "Do not change", serviceDate } as Parameters<typeof updateRecordingDetails>[0], db)).ok, false);
  }
  assert.deepEqual(state.patches, []);
  state.missing = true;
  assert.equal((await updateRecordingDetails({ churchId: "church-a", recordingId: "recording-a", serviceDate: "2024-02-29" }, db)).ok, false);
  assert.equal(state.serviceDate, "2026-11-08");
  state.missing = false; state.fail = true;
  assert.equal((await updateRecordingDetails({ churchId: "church-a", recordingId: "recording-a", serviceDate: "2024-02-29" }, db)).ok, false);
  assert.equal(state.serviceDate, "2026-11-08");
});

type Props = Parameters<typeof RecordingReview>[0];
type Element = { type: unknown; props: Record<string, unknown> };
function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return predicate(element) ? element : find(element.props.children, predicate);
}

function reviewHarness(published = false) {
  const props: Props = { recording: {
    id: "qa-recording", title: "QA recording", description: null, speaker: null, chapters: [], topics: [],
    seriesId: null, seriesName: null, serviceDate: "2026-11-08", recordedAt: "2026-11-13T03:11:00Z", createdAt: "2026-11-13T03:00:00Z",
    durationSec: 120, fullDurationSec: 120, trimStartSec: 0, trimEndSec: null, status: "ready", sourceKind: "file",
    phase: { phase: published ? "published" : "ready_to_publish", label: published ? "Published" : "Ready to publish", detail: null },
    posterUrl: null, autoPosterUrl: null, chosenPosterUrl: null, hasCustomArtwork: false,
    app: { published: false, visibility: null, publishedAt: null }, website: { published, publishedAt: published ? "2026-11-13T10:00:00Z" : null, listed: true },
    eventId: null, sessionId: null, segmentCount: 0, canPublish: true, publishBlockedReason: null, watchUrl: null,
  }, playback: null, series: [], thumbnails: [], settings: { autoPublish: false, defaultVisibility: "public", defaultSeriesId: null, publishToWebsite: true, notifyOnLive: false, notifyOnPublish: false },
  isAdmin: true, appEnabled: false, timeZone: "America/New_York", stats: null };
  const state = { saves: [] as Record<string, unknown>[], publishes: 0, refreshes: 0, errors: [] as string[], saveOk: true, calls: [] as string[] };
  const cells: unknown[] = [], work: Promise<unknown>[] = []; let cursor = 0;
  const react = {
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useState(initial: unknown) { const index = cursor++; cells[index] ??= { value: initial }; const cell = cells[index] as { value: unknown }; return [cell.value, (value: unknown) => { cell.value = typeof value === "function" ? value(cell.value) : value; }]; },
    useTransition() { cursor++; return [false, (callback: () => unknown) => { work.push(Promise.resolve(callback())); }]; },
  };
  const providers: Record<string, unknown> = {
    react, "@/components/media/recording-tags-field": { createRecordingTagsValue, recordingTagItems },
    "next/navigation": { useRouter: () => ({ refresh() { state.refreshes++; }, push() {} }) },
    sonner: { toast: { error(message: string) { state.errors.push(message); }, success() {} } },
    "@/components/ui/confirm-dialog": { confirmAction: async () => true },
    "@/app/dashboard/live-streaming/recording-actions": {
      saveRecordingDetailsAction: async (input: Record<string, unknown>) => { state.calls.push("save"); state.saves.push(input); return state.saveOk ? { ok: true } : { ok: false, error: "Date save failed. Try again." }; },
      publishRecordingAction: async () => { state.calls.push("publish"); state.publishes++; return { ok: true, data: { app: { published: false }, website: { published: true } } }; },
    },
  };
  const path = resolve("components/live-streaming/recordings/recording-review.tsx"), localRequire = createRequire(path);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const placeholders = new Proxy({}, { get: (_object, key) => String(key) });
  const compiled = { exports: {} as { RecordingReview: (props: Props) => unknown } };
  new Function("require", "module", "exports", source)((name: string) => providers[name] ?? (name.startsWith("@/components/") ? placeholders : localRequire(name)), compiled, compiled.exports);
  const render = () => {
    cursor = 0; const tree = compiled.exports.RecordingReview(props);
    return { date: find(tree, element => element.props.id === "rec-service-date")!,
      primary: find(tree, element => element.props.size === "lg" && typeof element.props.onClick === "function"),
      changeDate(value: string) { (find(tree, element => element.props.id === "rec-service-date")!.props.onChange as (event: unknown) => void)({ target: { value } }); },
      click() { return (find(tree, element => element.props.size === "lg" && typeof element.props.onClick === "function")!.props.onClick as () => Promise<void> | void)(); },
    };
  };
  return { props, state, render, async finish() { for (let i = 0; i < 15; i++) await Promise.resolve(); await Promise.all(work); } };
}

test("changing a published recording's date exposes Save changes, sends the chosen date and becomes clean after refresh", async () => {
  const h = reviewHarness(true);
  assert.equal(h.render().date.props.value, "2026-11-08"); assert.equal(h.render().date.props.type, "date"); assert.equal(h.render().date.props.required, true);
  assert.equal(h.render().primary, undefined);
  h.render().changeDate("2024-02-29"); assert.ok(h.render().primary);
  await h.render().click(); await h.finish();
  assert.equal(h.state.saves[0].serviceDate, "2024-02-29"); assert.equal(h.state.refreshes, 1); assert.equal(h.state.publishes, 0);
  h.props.recording.serviceDate = "2024-02-29"; assert.equal(h.render().primary, undefined);
});

test("publishing saves the chosen service date first and a failed date save keeps the edit without publishing", async () => {
  const h = reviewHarness(); h.render().changeDate("2024-02-29"); h.state.saveOk = false;
  await h.render().click(); await h.finish();
  assert.equal(h.state.publishes, 0); assert.equal(h.render().date.props.value, "2024-02-29"); assert.match(h.state.errors[0], /Try again/);
  h.state.saveOk = true; await h.render().click(); await h.finish();
  assert.equal(h.state.saves.at(-1)?.serviceDate, "2024-02-29"); assert.deepEqual(h.state.calls, ["save", "save", "publish"]);
});

test("review rejects an empty or invalid day before any date or publication write", async () => {
  const h = reviewHarness();
  for (const value of ["", "2026-02-29"]) { h.render().changeDate(value); await h.render().click(); await h.finish(); }
  assert.deepEqual(h.state.saves, []); assert.equal(h.state.publishes, 0); assert.equal(h.state.errors.length, 2);
});

function uploadActionHarness(t: TestContext) {
  const state = { admin: true, featureDenied: false, storageRequests: 0, inserts: [] as Record<string, unknown>[] };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "service-upload-date.example.test");
    if (url.pathname.startsWith("/storage/v1/object/upload/sign/")) {
      assert.match(url.pathname, /^\/storage\/v1\/object\/upload\/sign\/stream-recordings\/relay\/church-a\/upload-[0-9a-f-]+\.mp4$/);
      state.storageRequests++;
      return Response.json({ url: `/object/upload/sign/stream-recordings/qa.mp4?token=safe-fixture-token` });
    }
    assert.equal(url.pathname, "/rest/v1/stream_recordings"); assert.equal(init?.method, "POST");
    state.inserts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(null, { status: 201 });
  });
  const db = createClient("https://service-upload-date.example.test", "safe-test-key", { auth: { persistSession: false, autoRefreshToken: false } });
  const providers: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth/church": { getChurchAuth: async () => ({ isAdmin: state.admin, churchId: "church-a", userId: "admin-a" }) },
    "@/lib/features/guard": { featureActionError: async () => state.featureDenied ? "Live Stream is switched off." : null },
    "@/lib/security/rate-limit": { assertRateLimit: async () => ({ ok: true }) },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/stream/recording-upload-service": {},
  };
  const path = resolve("app/dashboard/live-streaming/upload-actions.ts"), localRequire = createRequire(path);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const compiled = { exports: {} as { prepareRecordingUpload: (input: { title: string; filename: string; size: number; durationSec: number; serviceDate?: unknown }) => Promise<{ ok: boolean; error?: string }> } };
  new Function("require", "module", "exports", source)((name: string) => providers[name] ?? localRequire(name), compiled, compiled.exports);
  return { state, prepare: compiled.exports.prepareRecordingUpload, input: { title: "Historical service", filename: "qa.mp4", size: 4096, durationSec: 60, serviceDate: "2024-02-29" } };
}

test("upload preparation persists the chosen historic service day in the authorized church and leaves the new recording private", async t => {
  const h = uploadActionHarness(t);
  assert.equal((await h.prepare(h.input)).ok, true);
  const inserted = h.state.inserts[0];
  assert.equal(inserted.service_date, "2024-02-29"); assert.equal(inserted.church_id, "church-a"); assert.equal(inserted.status, "processing");
  assert.equal(inserted.source_kind, "file"); assert.ok(inserted.processing_started_at);
  for (const untouched of ["recording_started_at", "created_at", "mobile_published_at", "web_published_at", "mobile_visibility"]) assert.equal(untouched in inserted, false, untouched);
  const legacy = { ...h.input, serviceDate: undefined };
  assert.equal((await h.prepare(legacy)).ok, true); assert.equal("service_date" in h.state.inserts[1], false);
});

test("upload preparation rejects invalid days and unauthorized callers before creating upload capabilities or rows", async t => {
  const h = uploadActionHarness(t);
  for (const serviceDate of ["", "2026-02-29", "2026-04-31", "0000-01-01", "infinity", null, 42]) {
    assert.equal((await h.prepare({ ...h.input, serviceDate })).ok, false);
  }
  h.state.admin = false; assert.equal((await h.prepare(h.input)).ok, false);
  h.state.admin = true; h.state.featureDenied = true; assert.equal((await h.prepare(h.input)).ok, false);
  assert.deepEqual(h.state.inserts, []); assert.equal(h.state.storageRequests, 0);
});
