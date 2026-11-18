import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { announcementWhen } from "@/lib/announcements/composer";
import { calendarEditFor } from "@/lib/announcements/calendar-edit";
import { eventRecurrenceRule } from "@/lib/announcements/recurrence";
import { allDaySpan } from "@/lib/integrations/all-day";
import type { CalendarEventPreview } from "@/lib/integrations/types";

function compile(path: string, providers: Record<string, unknown>) {
  const absolute = resolve(path), localRequire = createRequire(absolute);
  const source = ts.transpileModule(readFileSync(absolute, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const result = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", source)((name: string) => providers[name] ?? localRequire(name), result, result.exports);
  return result.exports;
}

test("All day ignores retained times, retains the chosen date in western timezones, and requires a time when switched off", () => {
  const input = { dated: true, date: "2026-11-15", startTime: "09:00", endTime: "10:00", timeZone: "America/Los_Angeles" };
  assert.deepEqual(announcementWhen({ ...input, allDay: true }), { startAt: "2026-11-15T00:00:00.000Z", endAt: null, allDay: true });
  assert.ok("error" in announcementWhen({ ...input, allDay: false, startTime: "" }));
  assert.ok("error" in announcementWhen({ ...input, allDay: true, date: "2026-02-30" }));
});

test("changing a timed calendar event to All day makes one full day, while existing all-day event lengths survive edits", () => {
  const original = { title: "Retreat", location: "Church", startAt: "2026-11-15T00:00:00.000Z", endAt: "2026-11-15T01:00:00.000Z", allDay: false };
  const changed = calendarEditFor({ title: original.title, location: original.location, startAt: original.startAt, endAt: null, allDay: true, original });
  assert.deepEqual(changed, { changed: true, endAt: "2026-11-16T00:00:00.000Z" });
  assert.deepEqual(calendarEditFor({ title: original.title, location: original.location, startAt: "2026-11-22T00:00:00.000Z", endAt: null, allDay: true, original: { ...original, allDay: true, endAt: "2026-11-18T00:00:00.000Z" } }), { changed: true, endAt: "2026-11-25T00:00:00.000Z" });
});

function calendarRoute(provider: "google" | "apple") {
  const googleRequests: Record<string, unknown>[] = [], appleRequests: string[] = [];
  const tokens = {
    getChurchCalendarId: async () => "church-calendar",
    getIntegrationStatus: async () => ({ google: { connected: provider === "google" }, apple: { connected: provider === "apple", readOnly: false } }),
    getIntegration: async () => ({ access_token: "fixture", metadata: { apple_id: "fixture@example.invalid", calendar_url: "https://caldav.icloud.com/fixture/calendar/" } }),
  };
  const googleOAuth = { getGoogleAuthClient: async () => ({}), isInvalidGrantError: () => false, GoogleReconnectRequiredError: class extends Error {} };
  const google = compile("lib/integrations/google-calendar.ts", {
    "@/lib/integrations/google-oauth": googleOAuth,
    "@/lib/integrations/tokens": tokens,
    googleapis: { google: { calendar: () => ({ events: { insert: async (request: { requestBody: Record<string, unknown> }) => {
      googleRequests.push(request.requestBody);
      return { data: { id: "fixture-event", ...request.requestBody } };
    } } }) } },
  });
  const apple = compile("lib/integrations/apple-calendar.ts", {
    "@/lib/integrations/tokens": tokens,
    "@/lib/integrations/caldav": { calDavRequest: async (_url: unknown, _credentials: unknown, request: { body: string }) => { appleRequests.push(request.body); return { text: "", etag: null }; } },
  });
  const calendar = compile("lib/integrations/calendar.ts", {
    "@/lib/integrations/tokens": tokens,
    "@/lib/integrations/google-calendar": google,
    "@/lib/integrations/apple-calendar": apple,
  });
  const route = compile("app/api/announcements/calendar/route.ts", {
    "@/lib/integrations/calendar": calendar,
    "@/lib/integrations/apple-calendar": apple,
    "@/lib/integrations/google-oauth": googleOAuth,
    "@/lib/auth/church": { getChurchAuth: async () => ({ churchId: "fixture-church", isAdmin: true, churchTimezone: "America/Los_Angeles" }) },
    "@/lib/supabase/server": { createClient: () => ({}) },
    "@/lib/features/guard": { featureAccessDenied: async () => null },
    "@/lib/announcements/email-queue": {},
    "@/lib/queries/announcements": {},
    "@/lib/attendance/v2/event-attendance": {},
  });
  return { post: route.POST as (request: Request) => Promise<Response>, googleRequests, appleRequests };
}

for (const provider of ["google", "apple"] as const) {
  test(`calendar POST creates an all-day ${provider} event with an exclusive end and date-only repeats`, async () => {
    const h = calendarRoute(provider);
    const response = await h.post(new Request("https://faithform.invalid/api/announcements/calendar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Church picnic", startAt: "2026-11-15T00:00:00.000Z", endAt: null, allDay: true, repeat: "custom", repeatUntil: "2026-11-29", customRepeat: { frequency: "weekly", interval: 1, weekdays: ["WE"] } }),
    }));
    assert.equal(response.status, 201);
    const { event } = await response.json() as { event: CalendarEventPreview };
    assert.equal(event.allDay, true);
    assert.equal(event.startAt, "2026-11-15T00:00:00.000Z");
    assert.equal(event.endAt, "2026-11-16T00:00:00.000Z");
    if (provider === "google") {
      assert.deepEqual(h.googleRequests[0].start, { date: "2026-11-15", dateTime: null });
      assert.deepEqual(h.googleRequests[0].end, { date: "2026-11-16", dateTime: null });
      assert.deepEqual(h.googleRequests[0].recurrence, ["RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,WE;WKST=SU;UNTIL=20261129"]);
    } else {
      assert.match(h.appleRequests[0], /DTSTART;VALUE=DATE:20261115/);
      assert.match(h.appleRequests[0], /DTEND;VALUE=DATE:20261116/);
      assert.match(h.appleRequests[0], /BYDAY=SU,WE;WKST=SU;UNTIL=20261129/);
    }
  });
}

test("calendar POST refuses timed attendance or timed instants on all-day events before any provider write", async () => {
  const h = calendarRoute("google");
  for (const patch of [{ attendance: { enabled: true } }, { startAt: "2026-11-15T09:00:00Z" }, { startAt: "2026-02-30T00:00:00.000Z" }]) {
    const result = await h.post(new Request("https://faithform.invalid/api/announcements/calendar", { method: "POST", body: JSON.stringify({ title: "Picnic", startAt: "2026-11-15T00:00:00.000Z", allDay: true, ...patch }) }));
    assert.equal(result.status, 400);
  }
  assert.equal(h.googleRequests.length, 0);
});

test("calendar POST still creates timed Google events with their supplied start and end instants", async () => {
  const h = calendarRoute("google");
  const result = await h.post(new Request("https://faithform.invalid/api/announcements/calendar", { method: "POST", body: JSON.stringify({ title: "Service", startAt: "2026-11-15T17:00:00Z", endAt: "2026-11-15T18:00:00Z", allDay: false }) }));
  assert.equal(result.status, 201);
  assert.deepEqual(h.googleRequests[0].start, { dateTime: "2026-11-15T17:00:00Z", timeZone: "America/Los_Angeles" });
  assert.deepEqual(h.googleRequests[0].end, { dateTime: "2026-11-15T18:00:00Z", timeZone: "America/Los_Angeles" });
  assert.equal((await result.json()).event.allDay, false);
});

test("all-day repeats use the chosen calendar weekday and an inclusive date end", () => {
  const rule = eventRecurrenceRule("custom", "2026-11-29", "2026-11-15T00:00:00.000Z", "America/Los_Angeles", { frequency: "weekly", interval: 1, weekdays: [] }, true);
  assert.equal(rule, "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;WKST=SU;UNTIL=20261129");
  assert.deepEqual(allDaySpan("2026-11-15T00:00:00.000Z", null), { start: "2026-11-15", end: "2026-11-16" });
});

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as Element;
  return [el, ...elements(el.props.children)];
}

test("the actual New calendar event dialog switches to a date, hides timed fields, and submits an all-day payload", async t => {
  const cells: { value: unknown }[] = [], effects: (() => void)[] = [];
  let cursor = 0;
  const react = {
    useState(initial: unknown) { const cell = cells[cursor++] ??= { value: initial }; return [cell.value, (value: unknown) => { cell.value = typeof value === "function" ? value(cell.value) : value; }]; },
    useEffect(effect: () => void) { if (!cells[cursor]) { cells[cursor] = { value: true }; effects.push(effect); } cursor++; },
  };
  const placeholder = new Proxy({}, { get: (_object, key) => String(key) });
  const localRequire = createRequire(resolve("components/announcements/create-event-dialog.tsx"));
  const providers = new Proxy({ react } as Record<string, unknown>, { get: (object, name: string) => object[name] ?? (name.startsWith("@/components/") || name === "lucide-react" ? placeholder : localRequire(name)) });
  const Dialog = compile("components/announcements/create-event-dialog.tsx", providers).CreateEventDialog as (props: Record<string, unknown>) => unknown;
  const props = { open: true, defaultDate: new Date(2026, 10, 15), timeZone: "America/Los_Angeles", attendanceCampuses: [], attendancePolicy: {}, onOpenChange() {}, onCreated() {} };
  const render = () => { cursor = 0; const tree = elements(Dialog(props)); effects.splice(0).forEach(effect => effect()); return tree; };
  render();
  let tree = render();
  const find = (id: string) => tree.find(el => el.props.id === id)!;
  (find("event-title").props.onChange as (event: unknown) => void)({ target: { value: "Picnic" } });
  (find("event-all-day").props.onCheckedChange as (checked: boolean) => void)(true);
  tree = render();
  assert.equal(find("event-start").type, "DatePicker");
  assert.equal(find("event-start").props.value, "2026-11-15");
  assert.equal(tree.some(el => el.props.id === "event-end"), false);
  let payload: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    payload = JSON.parse(String(init.body));
    return Response.json({ event: { title: "Picnic", allDay: true } });
  });
  await (tree.find(el => el.type === "form")!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  assert.equal(payload?.allDay, true);
  assert.equal(payload?.startAt, "2026-11-15T00:00:00.000Z");
  assert.equal(payload?.endAt, null);
  assert.equal((payload?.attendance as { enabled: boolean }).enabled, false);
  (find("event-all-day").props.onCheckedChange as (checked: boolean) => void)(false);
  tree = render();
  assert.equal(find("event-start").type, "DateTimePicker");
  assert.ok(find("event-end"));
});

test("the actual announcement composer submits the All day choice and restores a linked calendar event's date type", async () => {
  const cells: { value: unknown; current?: unknown }[] = [], work: Promise<unknown>[] = [];
  let cursor = 0, submitted: FormData | undefined;
  const react = {
    useState(initial: unknown) { const cell = cells[cursor++] ??= { value: typeof initial === "function" ? initial() : initial }; return [cell.value, (value: unknown) => { cell.value = typeof value === "function" ? value(cell.value) : value; }]; },
    useRef(initial: unknown) { return cells[cursor++] ??= { value: initial, current: initial }; },
    useReducer(reducer: (value: unknown, action: unknown) => unknown, initial: unknown) { const cell = cells[cursor++] ??= { value: initial }; return [cell.value, (action: unknown) => { cell.value = reducer(cell.value, action); }]; },
    useMemo(run: () => unknown) { return run(); }, useCallback(callback: unknown) { return callback; }, useEffect() {},
    useTransition() { return [false, (run: () => Promise<unknown>) => { work.push(run()); }]; },
  };
  const placeholder = new Proxy({}, { get: (_object, key) => String(key) });
  const localRequire = createRequire(resolve("components/announcements/announcement-composer.tsx"));
  const providers = new Proxy({
    react,
    "@/app/dashboard/announcements/actions": { publishAnnouncement: async (form: FormData) => { submitted = form; return { ok: true, inApp: true, errors: [] }; } },
  } as Record<string, unknown>, { get: (object, name: string) => object[name] ?? (name.startsWith("@/components/") || name === "lucide-react" ? placeholder : localRequire(name)) });
  const Composer = compile("components/announcements/announcement-composer.tsx", providers).AnnouncementComposer as (props: Record<string, unknown>) => unknown;
  const props = {
    mode: { kind: "calendar", event: { googleEventId: "fixture", calendarId: "primary", title: "Picnic", location: "Church", startAt: "2099-11-15T00:00:00.000Z", endAt: "2099-11-16T00:00:00.000Z", allDay: true } },
    settings: { churchId: "fixture", churchTimeZone: "America/Los_Angeles", appAvailable: true, emailAvailable: false, facebookConnected: false },
    onPosted() {}, onClose() {},
  };
  const render = () => { cursor = 0; return elements(Composer(props)); };
  const tree = render();
  const find = (id: string) => tree.find(el => el.props.id === id)!;
  assert.equal(find("composer-all-day").props.checked, true);
  assert.equal(find("composer-date").props.value, "2099-11-15");
  assert.equal(tree.some(el => el.props.id === "composer-start"), false);
  (tree.find(el => el.type === "Button" && el.props.size === "lg" && el.props.onClick)!.props.onClick as () => void)();
  await Promise.all(work.splice(0));
  assert.equal(submitted?.get("all_day"), "true");
  assert.equal(submitted?.get("start_at"), "2099-11-15T00:00:00.000Z");
  assert.equal(submitted?.get("end_at"), null);
  assert.equal(submitted?.get("original_all_day"), "true");
});
