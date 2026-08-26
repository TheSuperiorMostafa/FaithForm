import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const checkIn = read("lib/attendance/v2/check-in.ts");
const occurrences = read("lib/attendance/v2/occurrences.ts");
const roster = read("lib/attendance/v2/roster.ts");
const legacy = read("lib/attendance/v2/legacy.ts");
const jobs = read("lib/attendance/v2/jobs.ts");
// Prompt 6's `lib/attendance/v2/qr.ts` is gone. It signed a fifteen-minute
// capability with a single unversioned key and consumed its nonce globally, so
// the second person to scan a projector was refused. Prompt 8 replaced it with
// these three, and every property that file was asserted to have is asserted of
// them — see `tests/unit/attendance-sources.test.ts`.
const signing = read("lib/attendance/v2/signing.ts");
const shortCode = read("lib/attendance/v2/short-code.ts");
const checkinSession = read("lib/attendance/v2/checkin-session.ts");
const kiosk = read("lib/attendance/v2/kiosk.ts");
const kioskSession = read("lib/attendance/v2/kiosk-session.ts");
const mobileService = read("lib/mobile/v1/attendance-service.ts");
const adminActions = read("app/dashboard/attendance/services/actions.ts");

const ATTENDANCE_MODULES: [string, string][] = [
  ["check-in", checkIn],
  ["occurrences", occurrences],
  ["roster", roster],
  ["legacy", legacy],
  ["jobs", jobs],
  ["signing", signing],
  ["short-code", shortCode],
  ["checkin-session", checkinSession],
  ["kiosk", kiosk],
  ["kiosk-session", kioskSession],
  ["mobile-service", mobileService],
];

function attendanceRouteFiles(dir = "app/api/mobile/v1/attendance"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...attendanceRouteFiles(full));
    else if (entry === "route.ts") found.push(full);
  }
  return found;
}

// ---------------------------------------------------------------------------
// One authority
// ---------------------------------------------------------------------------

test("only one module calls the attendance command", () => {
  const callers = ATTENDANCE_MODULES.filter(([, source]) =>
    source.includes('rpc("record_attendance"'),
  );
  assert.equal(callers.length, 1, "record_attendance must have exactly one caller");
  assert.equal(callers[0][0], "check-in");
});

test("nothing writes a counted fact directly", () => {
  for (const [name, source] of ATTENDANCE_MODULES) {
    if (name === "legacy") continue; // the audited backfill, covered separately
    assert.ok(
      !/from\("attendance_facts"\)[\s\S]{0,200}\.insert\(/.test(source),
      `${name} inserts a counted fact directly`,
    );
  }
});

test("the legacy backfill is the one exception, and it is gated and reversible", () => {
  assert.match(legacy, /from\("attendance_facts"\)[\s\S]{0,200}\.insert\(/);
  // It refuses to run on ambiguous data without an explicit acknowledgement.
  assert.match(legacy, /legacy_backfill_blocked/);
  assert.match(legacy, /dryRun/);
  // And it records every decision.
  assert.match(legacy, /from\("attendance_legacy_map"\)/);
});

test("nothing deletes a counted fact or a correction", () => {
  for (const [name, source] of ATTENDANCE_MODULES.concat([["admin", adminActions]])) {
    for (const table of ["attendance_facts", "attendance_corrections", "attendance_attempts"]) {
      assert.ok(
        !new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}\\.delete\\(`).test(source),
        `${name} deletes from ${table}`,
      );
    }
  }
});

test("the legacy tables are never written by the new authority", () => {
  for (const [name, source] of ATTENDANCE_MODULES) {
    for (const table of ["attendance_records", "attendance_entries"]) {
      assert.ok(
        !new RegExp(`from\\("${table}"\\)[\\s\\S]{0,200}\\.(insert|update|upsert|delete)\\(`).test(
          source,
        ),
        `${name} writes legacy ${table}`,
      );
    }
  }
});

test("the unused aggregate attendance table is never adopted", () => {
  const all = ATTENDANCE_MODULES.map(([, source]) => source).join("\n");
  assert.ok(!/from\("attendance"\)/.test(all), "the aggregate table must not be used");
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("a self check-in resolves People only through the verified link", () => {
  const resolver = checkIn.slice(
    checkIn.indexOf("export async function resolveSelfCheckInMember"),
    checkIn.indexOf("export async function hasAutomaticAttendanceConsent"),
  );
  assert.match(resolver, /from\("visitor_people_links"\)/);
  assert.match(resolver, /\.eq\("is_active", true\)/);
  assert.match(resolver, /\.eq\("church_id", churchId\)/);

  // Email, phone, device and coordinates establish nothing.
  for (const forbidden of ["email", "phone", "device", "latitude", "longitude"]) {
    assert.ok(!resolver.includes(forbidden), `People resolution consults ${forbidden}`);
  }
});

test("a blocked or departed relationship cannot check in on an old link", () => {
  const resolver = checkIn.slice(
    checkIn.indexOf("export async function resolveSelfCheckInMember"),
    checkIn.indexOf("export async function hasAutomaticAttendanceConsent"),
  );
  assert.match(resolver, /state === "blocked" \|\| relationship\.state === "left"/);
  assert.match(resolver, /relationship_revoked/);
});

test("automatic attendance requires granted consent, not merely unset", () => {
  assert.match(checkIn, /auto_attendance_consent === "granted"/);
  // The mobile path checks it before ever reaching the command.
  assert.match(mobileService, /hasAutomaticAttendanceConsent/);
  assert.match(mobileService, /consent_revoked/);
  assert.match(mobileService, /consent_required/);
});

// ---------------------------------------------------------------------------
// What a client may not send
// ---------------------------------------------------------------------------

test("no mobile attendance route accepts a member, church, or result", () => {
  const routes = attendanceRouteFiles();
  assert.ok(routes.length >= 4, "attendance routes must exist");

  for (const file of routes) {
    const source = read(file);
    for (const forbidden of ["memberId", "churchId", "counted", "factId", "actorUserId"]) {
      assert.ok(
        !new RegExp(`searchParams\\.get\\("${forbidden}"`).test(source),
        `${file} reads ${forbidden} from the request`,
      );
    }
    assert.match(
      source,
      /(authenticatedRoute|optionalAuthRoute)\(/,
      `${file} bypasses the shared handler`,
    );
  }
});

test("the attempt request schema cannot carry an identity or a verdict", () => {
  const contract = read("lib/mobile/v1/contract.ts");
  const schema = contract.slice(
    contract.indexOf("export const attendanceAttemptRequestSchema"),
    contract.indexOf("export const attendanceConsentRequestSchema"),
  );

  // Asserted on declared **field keys**, not on substrings of the whole block.
  // The doc comments here discuss distance and results precisely in order to
  // say the client may not send them, so a substring sweep matches the
  // explanation rather than the schema. Reading the keys is both stricter and
  // immune to that: it catches `distanceBand` and `memberID` alike.
  const code = schema.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const keys = [...code.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 6, `expected to read the field list, got ${keys.join(", ")}`);

  for (const key of keys) {
    for (const forbidden of ["member", "church", "outcome", "counted", "distance", "band", "result"]) {
      assert.ok(
        !key.toLowerCase().includes(forbidden),
        `attempt request permits a ${forbidden} field: ${key}`,
      );
    }
  }

  // What it may carry: an occurrence, a source, and an observation.
  assert.ok(keys.includes("occurrenceId"));
  assert.ok(keys.includes("accuracyMeters"));
  assert.ok(keys.includes("dwellSeconds"));

  // Coordinates are permitted as *inputs to the server's own computation*, and
  // are bounded to real values. The band derived from them is server-side only.
  assert.ok(keys.includes("latitude"));
  assert.ok(keys.includes("longitude"));
  assert.match(code, /latitude: z\.number\(\)\.min\(-90\)\.max\(90\)\.optional\(\)/);
  assert.match(code, /longitude: z\.number\(\)\.min\(-180\)\.max\(180\)\.optional\(\)/);
});

test("the server bands distance itself, from the occurrence's own campus", () => {
  // This closes a real gap. `submitAttempt` previously passed `'inside'`
  // unconditionally, which made the command's `outside_region` branch
  // unreachable for a geofence attempt and contradicted the architecture
  // document. The band is now computed from the snapshotted campus position.
  const service = read("lib/mobile/v1/attendance-service.ts");
  const submit = service.slice(service.indexOf("export async function submitAttempt"));

  assert.ok(
    !/distanceBand:\s*input\.source === "qr" \? "inside" : "inside"/.test(submit),
    "the unconditional 'inside' band has returned",
  );
  assert.match(submit, /bandForAttempt\(\{/);
  assert.match(submit, /campus: \{[\s\S]{0,200}occurrence\.campus_latitude/);
  assert.match(submit, /occurrence\.geofence_radius_m/);

  // And the coordinates go no further than the computation.
  const code = submit.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !/latitude:\s*input\.latitude[\s\S]{0,80}recordAttendance/.test(code),
    "coordinates must not reach the attendance command",
  );
});

test("the capability response carries no geometry — that is a different endpoint", () => {
  const capability = mobileService.slice(
    mobileService.indexOf("export async function getAttendanceCapability"),
    mobileService.indexOf("export type AttemptInput"),
  );

  // This is a separation of concerns, **not** an anti-spoofing control. An
  // earlier version of this test claimed withholding the boundary made "am I
  // inside" unsolvable. That was wrong: a church's address is on its own
  // website and in the public discovery projection this codebase already
  // serves, so the boundary was never secret and hiding it bought nothing.
  //
  // The boundary is now served deliberately, by
  // `/attendance/[slug]/geofence-config` — gated, versioned, expiring, and
  // covered by `attendance-geofence-config.test.ts`. Capability answers "can
  // you check in right now"; it has no reason to repeat the geometry.
  //
  // The anti-spoofing control is server-side validation of submitted evidence
  // against the server's own campus and the occurrence's policy snapshot,
  // asserted below and in the migration suite.
  for (const forbidden of ["campus_latitude", "campus_longitude", "geofence_radius_m"]) {
    assert.ok(!capability.includes(forbidden), `capability leaks ${forbidden}`);
  }
});

test("presence is judged by the server, never by what the client asserts", () => {
  // The client reports an observation. It cannot send a distance, a verdict, or
  // a member. `record_attendance` re-derives the verdict from the occurrence's
  // snapshot — which is the actual control that survives a spoofed client.
  const migration = read("supabase/migrations/0055_attendance_authority.sql");
  const command = migration.slice(
    migration.indexOf("create or replace function public.record_attendance"),
    migration.indexOf("revoke all on function public.record_attendance"),
  );
  assert.match(command, /occ\.policy_snapshot ->> 'minDwellSeconds'/);
  assert.match(command, /occ\.policy_snapshot ->> 'requiresConfirmation'/);
  assert.match(command, /'outside_region'/);
  assert.match(command, /'insufficient_accuracy'/);
});

test("an attendance attempt requires an idempotency key", () => {
  const route = read("app/api/mobile/v1/attendance/attempt/route.ts");
  assert.match(route, /requireIdempotencyKey\(request\)/);
  assert.match(route, /cache: "private-no-store"/);
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

test("staff actions resolve the church from the session, never a payload", () => {
  assert.match(adminActions, /getChurchAuth\(\)/);
  assert.ok(
    !/export async function [a-zA-Z]+\([^)]*churchId/.test(adminActions),
    "an admin action exposes churchId as an argument",
  );
});

test("corrections and cancellation require an admin", () => {
  assert.match(adminActions, /async function requireCorrectionRights/);
  assert.match(adminActions, /if \(!context\.isAdmin\) throw new Error\("forbidden"\)/);
  // Both destructive-looking operations go through it.
  const correction = adminActions.slice(adminActions.indexOf("export async function applyCorrection"));
  assert.match(correction, /requireCorrectionRights\(\)/);
  const cancel = adminActions.slice(adminActions.indexOf("export async function cancelService"));
  assert.match(cancel, /requireCorrectionRights\(\)/);
});

test("every staff-side write carries an exact church predicate", () => {
  assert.match(occurrences, /\.eq\("id", input\.occurrenceId\)[\s\S]{0,200}\.eq\("church_id", input\.churchId\)/);
  assert.match(kiosk, /\.eq\("id", input\.credentialId\)[\s\S]{0,200}\.eq\("church_id", input\.churchId\)/);
});

test("bulk marking goes through the same command, one person at a time", () => {
  const bulk = roster.slice(
    roster.indexOf("export async function markPresentBulk"),
    roster.indexOf("/** A single manual add"),
  );

  // The delegation moved into SQL so the batch is one transaction rather than
  // N round trips — but it is still delegation. `record_attendance_batch` is a
  // wrapper that loops over `record_attendance`; it owns no insert of its own.
  assert.match(bulk, /admin\.rpc\("record_attendance_batch"/);

  const batchSql = readFileSync("supabase/migrations/0056_attendance_batch.sql", "utf8");
  assert.match(batchSql, /from public\.record_attendance\(/);
  // A second insert path here would be a second attendance authority.
  assert.ok(
    !/insert\s+into\s+public\.attendance_(facts|attempts)/i.test(batchSql),
    "the batch wrapper must never write attendance rows itself",
  );
  assert.ok(!/\.insert\(\[/.test(bulk), "bulk marking must not batch-insert facts");

  // Per-person idempotency, so re-running a batch is safe.
  assert.match(batchSql, /p_batch_key \|\| ':' \|\| target::text/);
  assert.match(bulk, /if \(input\.memberIds\.length > MAX_BULK_MEMBERS\)/);
  assert.match(batchSql, /if member_count > 1000 then/);
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test("no attendance module logs anything", () => {
  for (const [name, source] of ATTENDANCE_MODULES) {
    const logs = source.match(/console\.(log|info|warn|error|debug)\(/g) ?? [];
    assert.equal(logs.length, 0, `${name} logs: ${logs.join(", ")}`);
  }
});

test("a raw coordinate never reaches a counted fact or a report", () => {
  for (const [name, source] of [["roster", roster], ["jobs", jobs]] as const) {
    for (const forbidden of ["latitude", "longitude"]) {
      assert.ok(!source.includes(forbidden), `${name} handles ${forbidden}`);
    }
  }
});

test("accuracy is banded, never stored as a value", () => {
  const banding = mobileService.slice(
    mobileService.indexOf("function accuracyBand"),
    mobileService.indexOf("export async function submitAttempt"),
  );
  assert.match(banding, /"high" \| "medium" \| "low" \| "unusable"/);

  // The raw metres are classified and discarded. Asserted on the arguments
  // actually handed to the command — its own keys sit at six spaces — rather
  // than on everything textually after the call, because the band is now
  // computed inline and `bandForAttempt` legitimately *takes* the metres as a
  // computation input. What must never reach the attendance row is the value.
  const call = mobileService.slice(
    mobileService.indexOf("await recordAttendance("),
    mobileService.indexOf("const countedAt"),
  );
  const passed = [...call.matchAll(/^ {6}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  assert.ok(passed.includes("accuracyBand"), "the band must be what is stored");
  assert.ok(passed.includes("distanceBand"));

  for (const forbidden of ["accuracyMeters", "latitude", "longitude"]) {
    assert.ok(
      !passed.includes(forbidden),
      `${forbidden} must not reach the attendance command`,
    );
  }
});

test("the evidence purge empties the payload but keeps the audit row", () => {
  const cleanup = jobs.slice(
    jobs.indexOf("export async function runAttendanceCleanup"),
    jobs.indexOf("export type KioskCleanupResult"),
  );
  assert.match(cleanup, /precise_evidence: null/);
  // The attempt itself survives — the verdict is the auditable part.
  assert.ok(!/\.delete\(\)/.test(cleanup), "the purge must not delete attempts");
});

test("job responses are counts, not data", () => {
  for (const route of [
    "app/api/webhooks/attendance/generate/route.ts",
    "app/api/webhooks/attendance/cleanup/route.ts",
  ]) {
    const source = read(route)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

    assert.match(source, /compareSecret\(provided, process\.env\.CRON_SECRET\)/);
    assert.match(source, /status: 401/);
    assert.match(source, /"Cache-Control": "no-store"/);
    for (const forbidden of ["memberId", "member_id", "latitude", "churchName"]) {
      assert.ok(!source.includes(forbidden), `${route} exposes ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("no native geofencing, background location, or scanning was introduced", () => {
  const all = ATTENDANCE_MODULES.map(([, source]) => source).join("\n");
  for (const forbidden of [
    "CLLocationManager",
    "startMonitoring",
    "GeofencingClient",
    "ACCESS_BACKGROUND_LOCATION",
    "BGTaskScheduler",
    "AVCaptureSession",
    "significantLocationChange",
  ]) {
    assert.ok(!all.includes(forbidden), `Prompt 6 must not implement ${forbidden}`);
  }
});

test("no livestream, sermon, or giving capability was introduced", () => {
  const all = ATTENDANCE_MODULES.map(([, source]) => source).join("\n") + adminActions;
  for (const forbidden of [
    "stream_recordings",
    "stream_events",
    "sermons",
    "giving_donations",
    "payment_intent",
  ]) {
    assert.ok(!all.includes(forbidden), `Prompt 6 must not touch ${forbidden}`);
  }
});

test("a capability is enabled only when both platforms have a screen for it", () => {
  // This test used to assert the opposite: that `attendance` must **not** be
  // enabled, because Prompt 6 wrote it before Prompts 7 and 8 built the clients.
  //
  // They exist now, and Prompt 12 registers them — so the old assertion had
  // become a guard against the finished product. What replaces it is **stricter
  // in both directions**: a capability may not be on without screens behind it
  // on both platforms, and a capability with screens on both platforms may not
  // be left off by accident, which is exactly how attendance and giving stayed
  // invisible after they were finished.
  const accountService = read("lib/mobile/v1/account-service.ts");
  const capabilities = accountService.slice(
    accountService.indexOf("export const ENABLED_CAPABILITIES"),
    accountService.indexOf("function projectProfile"),
  );

  const ios = read("apps/faithful-ios/App/AppDependencies.swift");
  const android = read(
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/MainActivity.kt",
  );

  // capability key → the destination identity each platform registers
  const screens: Record<string, string> = {
    attendance: "checkIn",
    giving: "give",
    watch: "watch",
    announcements: "announcements",
    discovery: "churchDiscovery",
    sermons: "sermonArchive",
  };

  for (const [capability, destination] of Object.entries(screens)) {
    const enabled = capabilities.includes(`"${capability}"`);
    // iOS registers by enum case; Android by identity string.
    const iosHas = ios.includes(`.${destination}(`) || ios.includes(`.${destination},`);
    const androidHas = android.includes(`"${destination === "churchDiscovery" ? "discover" : destination}"`);

    if (enabled) {
      assert.ok(iosHas, `${capability} is enabled and iOS registers no screen`);
      assert.ok(androidHas, `${capability} is enabled and Android registers no screen`);
    } else {
      // The honest inverse: a capability that is off must be off because a
      // platform lacks the screen, not because somebody forgot.
      assert.ok(
        !iosHas || !androidHas,
        `${capability} has screens on both platforms and is still switched off`,
      );
    }
  }

  // The specific case this file was written about, now stated as the fact it is.
  assert.ok(
    capabilities.includes('"attendance"'),
    "attendance is built on both platforms and must be enabled",
  );
  // And the specific case that is still genuinely absent.
  assert.ok(
    !capabilities.includes('"sermons"'),
    "sermons has no screen on either platform and must stay off",
  );
});
