import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { PRIVACY_VERSION } from "@/lib/legal/policy-versions";

/**
 * Automatic attendance from the church's side and the server's: who may change
 * a church's check-in setup, what the mobile endpoints re-check on every call,
 * what is kept and for how long, and whether the public pages say so.
 *
 * Source inspection, in the style of the other attendance security suites. The
 * SQL is executed in `tests/database/automatic-attendance-setup.test.ts`.
 */

const read = (path: string) => readFileSync(path, "utf8");
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const setupActions = read("app/dashboard/attendance/setup/actions.ts");
const setupLib = read("lib/attendance/v2/setup.ts");
const geocode = read("lib/attendance/v2/geocode.ts");
const service = read("lib/mobile/v1/attendance-service.ts");
const serviceCode = stripComments(service);
const geofenceConfig = read("lib/attendance/v2/geofence-config.ts");
const jobs = read("lib/attendance/v2/jobs.ts");
const occurrences = read("lib/attendance/v2/occurrences.ts");
const account = read("lib/faithform/account.ts");
const occurrenceRoute = read("app/api/mobile/v1/attendance/[slug]/occurrence/route.ts");
const board = read("components/attendance/service-occurrences-board.tsx");
const map = read("components/attendance/campus-radius-map.tsx");
const layout = read("app/dashboard/attendance/layout.tsx");
const privacy = read("app/privacy/page.tsx");
const deletion = read("app/account-deletion/page.tsx");

/** One exported action's body, up to the next export. */
function exported(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  const next = source.indexOf("export ", start + 10);
  return source.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------------------
// Who may change check-in setup
// ---------------------------------------------------------------------------

test("check-in setup resolves the church from the session and never from a payload", () => {
  assert.match(setupActions, /getChurchAuth\(\)/);
  assert.match(setupActions, /featureActionError\("attendance"\)/);
  assert.doesNotMatch(setupActions, /export async function [a-zA-Z]+\([^)]*churchId/);
});

test("every change to check-in setup requires a church admin", () => {
  assert.match(setupActions, /if \(!context\.isAdmin\) \{\s*throw new VisitorError\("forbidden"/);
  for (const name of ["saveCheckinPolicy", "saveCampusLocation", "addMainCampus", "findAddress", "saveServiceTimes"]) {
    assert.match(exported(setupActions, name), /await requireSetupAdmin\(\)/, name);
  }
  // Reading is Attendance-level, not admin-level.
  assert.match(exported(setupActions, "getCheckinSetup"), /await requireSetupViewer\(\)/);
});

test("every setup write carries the church predicate, is audited, and reaches upcoming services", () => {
  for (const name of ["saveChurchAttendancePolicy", "saveCampusCheckinLocation", "saveServiceSchedule"]) {
    const body = exported(setupLib, name);
    assert.match(body, /\.eq\("church_id", input\.churchId\)/, `${name} lacks a tenant predicate`);
    assert.match(body, /recordSetupEvent\(admin, \{/, `${name} is not audited`);
    assert.match(body, /syncChurchOccurrences\(input\.churchId, \{ client: admin \}\)/, `${name} leaves services stale`);
  }
  // A campus named in a schedule must belong to this church.
  assert.match(exported(setupLib, "saveServiceSchedule"), /That campus is not in this church/);
});

test("an opt-in count below the floor is never shown to a church", () => {
  assert.match(setupLib, /optedInPeople: publishableOptInCount\(optedInResult\.count \?\? 0\)/);
  // Counts only: no account, member or name is selected for the readiness card.
  const readiness = exported(setupLib, "getAttendanceSetupState");
  assert.match(readiness, /\{ count: "exact", head: true \}/);
  assert.doesNotMatch(readiness, /first_name|last_name|display_name|email/);
});

test("the address lookup is rate limited per church and sends only the address", () => {
  assert.match(exported(setupActions, "findAddress"), /checkRateLimit\(`attendance:geocode:\$\{churchId\}`/);
  const code = stripComments(geocode);
  assert.match(code, /url\.searchParams\.set\("q", parsed\.data\)/);
  assert.doesNotMatch(code, /churchId|userId|account|member/i);
  assert.match(code, /"User-Agent"/);
});

test("the campus map uses public OpenStreetMap tiles with attribution and no API key", () => {
  assert.match(read("lib/maps/web-mercator.ts"), /https:\/\/tile\.openstreetmap\.org\//);
  assert.match(map, /© OpenStreetMap contributors/);
  for (const source of [map, read("lib/maps/web-mercator.ts"), read("components/attendance/campus-location-editor.tsx")]) {
    assert.doesNotMatch(source, /maps\.googleapis|api[_-]?key|mapbox|NEXT_PUBLIC_[A-Z_]*MAP/i);
  }
  // Nothing in the Next config restricts image sources, so plain <img> tiles load.
  assert.doesNotMatch(read("next.config.mjs"), /img-src/);
});

test("the attendance client components import no server module values", () => {
  // `checkin-setup.tsx` once imported a constant from `lib/attendance/v2/setup.ts`,
  // which reaches the service-role client and `next/headers`. Typecheck and the
  // tests passed; only `next build` refused it. Types are erased, server actions
  // are references, and these modules are dependency-free.
  const CLIENT_SAFE = new Set([
    "@/lib/maps/web-mercator",
    "@/lib/attendance/v2/setup-bounds",
    "@/lib/attendance/v2/setup-view",
    "@/lib/attendance/v2/sunday-worship",
    "@/lib/utils",
  ]);
  const dir = "components/attendance";
  const files = readdirSync(dir).filter((file) => file.endsWith(".tsx"));
  assert.ok(files.length >= 6);

  for (const file of files) {
    const source = read(`${dir}/${file}`);
    if (!source.startsWith('"use client"')) continue;
    for (const match of source.matchAll(/^import (?!type )[^;]*?from "(@\/lib\/[^"]+)";/gm)) {
      assert.ok(CLIENT_SAFE.has(match[1]), `${file} imports a value from ${match[1]}`);
    }
  }

  assert.doesNotMatch(read("lib/attendance/v2/setup-bounds.ts"), /^import /m);
  assert.doesNotMatch(read("lib/attendance/v2/setup-view.ts"), /^import /m);
  assert.doesNotMatch(read("lib/attendance/v2/sunday-worship.ts"), /^import /m);
});

test("Services and Setup are reachable from the Attendance tabs", () => {
  // One tab strip for the whole section, shared with Kids check-in.
  const tabs = read("lib/attendance/section-tabs.ts");
  assert.match(layout, /attendanceSectionTabs\(/);
  assert.match(tabs, /href: "\/dashboard\/attendance\/services"/);
  assert.match(tabs, /href: "\/dashboard\/attendance\/setup"/);
  assert.match(read("app/dashboard/attendance/setup/layout.tsx"), /<FeatureGate feature="attendance">/);
  assert.match(read("app/dashboard/attendance/services/layout.tsx"), /<FeatureGate feature="attendance">/);
});

test("staff see how each person was counted, in words and not by colour alone", () => {
  for (const [source, label] of [
    ["geofence", "Checked in on their phone"],
    ["qr", "Scanned the code on screen"],
    ["kiosk", "Checked in at the kiosk"],
    ["manual", "Marked by staff"],
  ] as const) {
    assert.match(board, new RegExp(`${source}: \\{\\s*label: "${label}",\\s*icon: \\w+`), source);
  }
  // Per-service totals by method come from the SQL aggregate, not from facts.
  const actions = read("app/dashboard/attendance/services/actions.ts");
  assert.match(exported(actions, "getServicesBoard"), /getAttendanceReport\(\{/);
});

// ---------------------------------------------------------------------------
// The mobile endpoints
// ---------------------------------------------------------------------------

test("an automatic attempt is throttled per account before anything is read", () => {
  const submit = exported(serviceCode, "submitAttempt");
  const throttle = submit.indexOf("throttleAutomaticAttempt(account.id)");
  const firstRead = submit.indexOf('.from("service_occurrences")');
  assert.ok(throttle > 0, "no throttle");
  assert.ok(throttle < firstRead, "the throttle runs after the occurrence is read");
  assert.match(serviceCode, /checkRateLimit\(\s*`attendance:geofence:\$\{accountId\}`/);
  assert.match(serviceCode, /AUTOMATIC_ATTEMPT_BUDGET = \{ limit: 60, windowMs: 10 \* 60 \* 1000 \}/);
  assert.match(submit, /return reject\("attempt_throttled"/);
});

test("an automatic attempt needs an active account, consent, and the church's live switch", () => {
  const submit = exported(serviceCode, "submitAttempt");
  assert.match(submit, /const account = await requireActiveAccount\(userId\)/);
  const consent = submit.indexOf("hasAutomaticAttendanceConsent(account.id, admin)");
  const live = submit.indexOf("isAutomaticAttendanceLive(churchId, admin)");
  const record = submit.indexOf("await recordAttendance(");
  assert.ok(consent > 0 && live > consent && record > live);
  assert.match(submit, /return reject\("source_disabled", occurrenceId\)/);

  const liveCheck = exported(stripComments(geofenceConfig), "isAutomaticAttendanceLive");
  assert.match(liveCheck, /geofence_enabled/);
  assert.match(liveCheck, /isChurchFeatureEnabled\(churchId, "attendance"\)/);
});

test("the region only redirects an attempt to an open service of the same church", () => {
  const submit = exported(serviceCode, "submitAttempt");
  assert.match(submit, /campusIdFromRegionId\(input\.regionId\)/);
  assert.match(submit, /findOpenOccurrence\(churchId, \{\s*campusId: regionCampusId,/);
  assert.match(submit, /reloaded\.church_id === churchId/);
  // And the band is still computed from the occurrence the server loaded.
  assert.match(submit, /latitude: occurrence\.campus_latitude/);
});

test("a replayed attempt can never return an outcome the contract lacks", () => {
  const submit = exported(serviceCode, "submitAttempt");
  assert.match(submit, /const outcome = contractOutcome\(result\.outcome\)/);
  assert.doesNotMatch(submit, /outcome: result\.outcome/);
});

test("the occurrence and capability endpoints require a relationship with the church", () => {
  assert.match(exported(serviceCode, "getEligibleOccurrence"), /await resolveRelatedChurch\(userId, churchSlug\)/);
  assert.match(exported(serviceCode, "getAttendanceCapability"), /await resolveRelatedChurch\(userId, churchSlug\)/);
  const resolver = service.slice(service.indexOf("async function resolveRelatedChurch"));
  assert.match(resolver, /relationship\.state === "blocked" \|\| relationship\.state === "left"/);
  assert.match(occurrenceRoute, /searchParams\.get\("regionId"\)\?\.slice\(0, 200\)/);
});

test("the geofence configuration picks the same campuses every time and honours the platform switch", () => {
  const code = stripComments(geofenceConfig);
  const campuses = code.slice(code.indexOf('.from("church_campuses")'), code.indexOf(".limit(20)"));
  assert.match(campuses, /\.eq\("is_public", true\)/);
  assert.match(campuses, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(code, /isChurchFeatureEnabled\(churchId, "attendance"\)/);
  assert.match(code, /\.eq\("policy_snapshot->sources->>geofence", "true"\)/);
});

test("the consent result carries the authorization version after the bump", () => {
  const consent = exported(account, "recordConsent");
  const bump = consent.indexOf("await bumpAuthorizationVersion(account.id, admin)");
  const reread = consent.indexOf("const { data: current }");
  assert.ok(bump > 0 && reread > bump, "the returned account predates the bump");
  assert.match(consent, /return mapAccount\(current \?\? data\)/);
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test("withdrawing consent removes pending evidence", () => {
  const consent = exported(account, "recordConsent");
  assert.match(
    consent,
    /if \(parsed\.data\.autoAttendanceConsent !== "granted"\) \{\s*await admin\.rpc\("withdraw_automatic_attendance_evidence"/,
  );
});

test("the daily cleanup purges expired detections and check-in artifacts", () => {
  const cleanup = jobs.slice(
    jobs.indexOf("export async function runAttendanceCleanup"),
    jobs.indexOf("export type KioskCleanupResult"),
  );
  assert.match(cleanup, /rpc\(\s*"purge_expired_attendance_detections"/);
  assert.match(cleanup, /rpc\("purge_attendance_checkin_artifacts"/);
  assert.match(read("vercel.json"), /"path": "\/api\/webhooks\/attendance\/cleanup"/);
});

test("the generation job rotates through every church and refreshes before generating", () => {
  const generation = jobs.slice(
    jobs.indexOf("export async function runOccurrenceGeneration"),
    jobs.indexOf("export type LifecycleResult"),
  );
  assert.match(generation, /\.order\("id", \{ ascending: true \}\)\s*\.range\(slice\.from, slice\.to\)/);
  assert.match(generation, /syncChurchOccurrences\(church\.id/);
  const sync = exported(occurrences, "syncChurchOccurrences");
  assert.ok(
    sync.indexOf("refresh_upcoming_service_occurrences") < sync.indexOf("generateOccurrences("),
    "refresh must run before generation, or a moved service is doubled",
  );
});

test("every other place service times or campuses change reaches upcoming services", () => {
  assert.match(read("app/dashboard/website/actions.ts"), /await syncChurchOccurrencesAfterChange\(auth\.churchId\)/);
  assert.match(read("app/admin/church-profile-actions.ts"), /await syncChurchOccurrencesAfterChange\(churchId\)/);
  const settings = read("app/dashboard/settings/faithform-actions.ts");
  assert.match(exported(settings, "saveCampus"), /await syncChurchOccurrencesAfterChange\(churchId\)/);
  assert.match(exported(settings, "retireCampus"), /await syncChurchOccurrencesAfterChange\(churchId\)/);
});

// ---------------------------------------------------------------------------
// The public pages
// ---------------------------------------------------------------------------

test("the privacy policy describes automatic check-in as the code does it", () => {
  const section = privacy.slice(privacy.indexOf('id="automatic-check-in"'), privacy.indexOf('id="camera"') > 0 ? privacy.indexOf('id="camera"') : privacy.indexOf("<h3>Camera</h3>"));
  for (const [claim, pattern] of [
    ["it is optional", /Automatic check-in is optional/],
    ["code and staff check-in remain", /scanning or typing\s+your church&apos;s check-in code, or be marked present by church staff/],
    ["only arrival at church locations", /Only your arrival at the\s+locations your church has set up/],
    ["only during a check-in window", /Only when you arrive during a\s+service&apos;s check-in window/],
    ["coordinates are never stored", /We never store your\s+coordinates/],
    ["the arrival record expires", /after two hours and is\s+deleted automatically within about a day/],
    ["the church never sees location", /Your church never\s+sees your location/],
    ["how to turn it off", /Turn automatic check-in off in the\s+app at any time/],
    ["the Android mock flag", /whether your phone reported the location\s+as simulated/],
  ] as const) {
    assert.match(section, pattern, claim);
  }
});

test("the check-in clarification is still recorded as one that moved nothing", () => {
  // The clarification itself did not move the version. The version did later
  // move, to 2026-09-20, for collection the August text did not disclose at
  // all — the photos people upload and the messages Stream carries — which is
  // a different thing and is documented separately on the page.
  assert.equal(PRIVACY_VERSION, "2026-09-20");
  assert.match(privacy, /without\s+\* moving PRIVACY_VERSION/);
  assert.match(privacy, /PRIVACY_VERSION did move to 2026-09-20/);
});

test("the account deletion page covers a pending automatic check-in", () => {
  assert.match(deletion, /any automatic check-in that was still waiting to be confirmed/);
  assert.match(deletion, /check-ins\s+made by scanning a code or automatically/);
});
