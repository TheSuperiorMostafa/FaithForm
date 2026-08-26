import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

import {
  resolveExpiry,
  type GeofenceConfiguration,
  type GeofenceWindow,
} from "@/lib/attendance/v2/geofence-config";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";

const source = readFileSync("lib/attendance/v2/geofence-config.ts", "utf8");
const route = readFileSync(
  "app/api/mobile/v1/attendance/[slug]/geofence-config/route.ts",
  "utf8",
);
const contract = readFileSync("lib/mobile/v1/contract.ts", "utf8");

/**
 * Comments removed.
 *
 * Both files explain at length *why* the integrity field was removed, so a
 * forbidden-word sweep over the raw text matches the explanation rather than
 * any code. Asserting against my own prose is a false positive, not a finding.
 */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const sourceCode = stripComments(source);
const routeCode = stripComments(route);

/**
 * Every native source file, excluding build output and package caches.
 *
 * A directory walk rather than `git ls-files`, because `apps/` is not committed
 * yet — a tracked-file listing would silently return nothing and turn the
 * forbidden-symbol sweep into a test that checks nothing at all.
 */
const NATIVE_SOURCE_EXTENSIONS = new Set([
  ".swift",
  ".kt",
  ".kts",
  ".xml",
  ".gradle",
  ".plist",
  ".pbxproj",
]);

const SKIP_DIRECTORIES = new Set([
  "build",
  ".build",
  ".gradle",
  "DerivedData",
  ".idea",
  "Pods",
  "node_modules",
]);

function nativeSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...nativeSourceFiles(path));
    } else if (NATIVE_SOURCE_EXTENSIONS.has(extname(entry))) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// A faithful stand-in for the route's cache decision
// ---------------------------------------------------------------------------

const REVALIDATION_PERIOD_MS = 15 * 60 * 1000;

const window = (
  opens: string,
  closes: string,
  id = "22222222-2222-4222-8222-222222222222",
): GeofenceWindow => ({
  occurrenceId: id,
  label: "Sunday Morning",
  startsAt: "2026-08-30T14:00:00Z",
  endsAt: "2026-08-30T15:30:00Z",
  checkinOpensAt: opens,
  checkinClosesAt: closes,
  timezone: "America/New_York",
});

const configuration = (
  overrides: Partial<GeofenceConfiguration> = {},
): GeofenceConfiguration => ({
  churchSlug: "grace",
  regions: [
    {
      regionId: "faithful.campus.11111111-1111-4111-8111-111111111111",
      campusName: "Main",
      latitude: 38.2527,
      longitude: -85.7585,
      radiusMeters: 150,
    },
  ],
  windows: [],
  sources: { geofence: true, qr: false, manual: true },
  requiresConfirmation: true,
  minDwellSeconds: 120,
  maxLocationAccuracyM: 100,
  configVersion: 1007,
  expiresAt: "2026-08-30T13:30:00Z",
  ...overrides,
});

/**
 * Mirrors the route exactly: body, then an ETag over the whole body.
 *
 * Kept in one place so a scenario cannot accidentally test a different rule
 * from the one the route applies. A test below asserts the route really does
 * compute its validator this way.
 */
function respond(
  slug: string,
  result:
    | { ok: true; configuration: GeofenceConfiguration }
    | { ok: false; reason: string },
  ifNoneMatch?: string,
) {
  const data = result.ok
    ? { configuration: result.configuration, refusalReason: null, message: null }
    : { configuration: null, refusalReason: result.reason, message: "refused" };

  const etag = computeEtag({ church: slug, data });
  const notModified = etagMatches(ifNoneMatch, etag);

  return { status: notModified ? 304 : 200, etag, data: notModified ? null : data };
}

// ---------------------------------------------------------------------------
// The expiry algorithm
// ---------------------------------------------------------------------------

test("the expiry is stable within a bucket, moving only at boundaries", () => {
  // Not independent of `now` — `now` chooses the bucket. What matters is that
  // two requests inside the same bucket agree, because `expiresAt` is in the
  // body and the body is what the ETag covers.
  const a = resolveExpiry(new Date("2026-08-30T12:00:01Z"), []);
  const b = resolveExpiry(new Date("2026-08-30T12:07:43Z"), []);
  assert.equal(a, b);
  assert.equal(a, "2026-08-30T12:15:00.000Z");
});

test("the expiry is always strictly in the future, including on a boundary", () => {
  for (const instant of [
    "2026-08-30T12:00:00Z", // exactly on a bucket edge
    "2026-08-30T12:14:59Z",
    "2026-08-30T12:15:00Z",
    "2026-08-30T00:00:00Z",
  ]) {
    const now = new Date(instant);
    const expiry = Date.parse(resolveExpiry(now, []));
    assert.ok(expiry > now.getTime(), `${instant} produced a non-future expiry`);
    assert.ok(expiry - now.getTime() <= REVALIDATION_PERIOD_MS);
  }
});

test("the expiry clamps to the next check-in boundary", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  // Opens before the bucket would end, so that is when the answer changes.
  const opens = "2026-08-30T12:05:00Z";
  const expiry = resolveExpiry(now, [window(opens, "2026-08-30T16:00:00Z")]);
  assert.equal(expiry, new Date(opens).toISOString());
});

test("a boundary already in the past does not pull the expiry backwards", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const expiry = resolveExpiry(now, [
    window("2026-08-30T11:00:00Z", "2026-08-30T11:30:00Z"),
  ]);
  assert.equal(expiry, "2026-08-30T12:15:00.000Z");
  assert.ok(Date.parse(expiry) > now.getTime());
});

test("the earliest of several boundaries wins", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const expiry = resolveExpiry(now, [
    window("2026-08-30T12:10:00Z", "2026-08-30T14:00:00Z", "a"),
    window("2026-08-30T12:03:00Z", "2026-08-30T13:00:00Z", "b"),
  ]);
  assert.equal(expiry, "2026-08-30T12:03:00.000Z");
});

test("an unparseable boundary is ignored rather than poisoning the expiry", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const expiry = resolveExpiry(now, [window("not-a-date", "also-not-a-date")]);
  assert.equal(expiry, "2026-08-30T12:15:00.000Z");
});

// ---------------------------------------------------------------------------
// The property the client depends on
// ---------------------------------------------------------------------------

test("revalidating before expiry yields 304", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const config = configuration({ expiresAt: resolveExpiry(now, []) });
  const first = respond("grace", { ok: true, configuration: config });
  assert.equal(first.status, 200);

  // Same bucket, so the same configuration and the same expiry.
  const later = new Date("2026-08-30T12:09:00Z");
  const unchanged = configuration({ expiresAt: resolveExpiry(later, []) });
  const second = respond("grace", { ok: true, configuration: unchanged }, first.etag);

  assert.equal(second.status, 304);
  // The 304 is only safe because the cached expiry is still ahead of the clock.
  assert.ok(Date.parse(config.expiresAt) > later.getTime());
});

test("revalidating AFTER expiry never yields 304", () => {
  // This is the bug this design exists to make unreachable. The old version
  // returned `now + TTL` and excluded it from the validator, so a client whose
  // configuration had expired was told "not modified", received no new expiry,
  // and could never get out of that state.
  const issuedAt = new Date("2026-08-30T12:00:00Z");
  const held = configuration({ expiresAt: resolveExpiry(issuedAt, []) });
  const issued = respond("grace", { ok: true, configuration: held });

  const afterExpiry = new Date(Date.parse(held.expiresAt) + 1000);
  const fresh = configuration({ expiresAt: resolveExpiry(afterExpiry, []) });
  const revalidated = respond("grace", { ok: true, configuration: fresh }, issued.etag);

  assert.equal(revalidated.status, 200, "an expired configuration must not 304");
  assert.notEqual(fresh.expiresAt, held.expiresAt);
  assert.ok(Date.parse(fresh.expiresAt) > afterExpiry.getTime());
});

test("the no-stale-304 property holds across many instants", () => {
  // The proof in `resolveExpiry`'s doc comment, exercised rather than asserted:
  // for every issue time and every revalidation at or after the resulting
  // expiry, the new expiry must differ — hence a different ETag, hence a 200.
  const windows = [window("2026-08-30T12:05:00Z", "2026-08-30T12:40:00Z")];

  for (let minute = 0; minute < 120; minute += 1) {
    const issuedAt = new Date(Date.UTC(2026, 7, 30, 11, minute, 17));
    const held = resolveExpiry(issuedAt, windows);
    assert.ok(Date.parse(held) > issuedAt.getTime(), `expiry not future at ${issuedAt}`);

    for (const offsetMs of [0, 1, 1000, 60_000]) {
      const revalidatedAt = new Date(Date.parse(held) + offsetMs);
      const fresh = resolveExpiry(revalidatedAt, windows);
      assert.notEqual(
        fresh,
        held,
        `stale 304 possible: issued ${issuedAt.toISOString()}, held ${held}`,
      );
    }
  }
});

test("a client revalidating an expired configuration gets a refusal, not a 304", () => {
  // The other branch: access was revoked while the configuration sat expired.
  // The client must learn that, not receive "not modified".
  const issuedAt = new Date("2026-08-30T12:00:00Z");
  const held = configuration({ expiresAt: resolveExpiry(issuedAt, []) });
  const issued = respond("grace", { ok: true, configuration: held });

  const revoked = respond("grace", { ok: false, reason: "consent_required" }, issued.etag);

  assert.equal(revoked.status, 200);
  assert.equal(revoked.data?.configuration, null);
  assert.equal(revoked.data?.refusalReason, "consent_required");
});

// ---------------------------------------------------------------------------
// What changes the validator
// ---------------------------------------------------------------------------

test("configuration unchanged but expiration changed is a 200, not a 304", () => {
  const base = configuration({ expiresAt: "2026-08-30T12:15:00.000Z" });
  const first = respond("grace", { ok: true, configuration: base });

  const sameButLater = configuration({ expiresAt: "2026-08-30T12:30:00.000Z" });
  const second = respond("grace", { ok: true, configuration: sameButLater }, first.etag);

  assert.equal(second.status, 200);
  assert.notEqual(first.etag, second.etag);
  assert.equal(second.data?.configuration?.expiresAt, "2026-08-30T12:30:00.000Z");
});

test("a changed config version changes the validator", () => {
  const first = respond("grace", { ok: true, configuration: configuration() });
  const bumped = respond(
    "grace",
    { ok: true, configuration: configuration({ configVersion: 1008 }) },
    first.etag,
  );
  assert.equal(bumped.status, 200);
  assert.notEqual(first.etag, bumped.etag);
});

test("a moved region changes the validator", () => {
  const first = respond("grace", { ok: true, configuration: configuration() });
  const moved = respond(
    "grace",
    {
      ok: true,
      configuration: configuration({
        regions: [
          {
            regionId: "faithful.campus.11111111-1111-4111-8111-111111111111",
            campusName: "Main",
            latitude: 0,
            longitude: 0,
            radiusMeters: 150,
          },
        ],
      }),
    },
    first.etag,
  );
  assert.equal(moved.status, 200);
});

test("a changed window set changes the validator", () => {
  const first = respond("grace", { ok: true, configuration: configuration() });
  const withWindow = respond(
    "grace",
    {
      ok: true,
      configuration: configuration({
        windows: [window("2026-08-30T13:30:00Z", "2026-08-30T16:00:00Z")],
      }),
    },
    first.etag,
  );
  assert.equal(withWindow.status, 200);
});

test("every semantic field is covered, because the validator is the body", () => {
  // Field-by-field rather than a spot check: flipping any one of them must
  // change the ETag. A hand-picked validator subset is exactly how the original
  // `expiresAt` bug happened, and this is the assertion that would have caught
  // it.
  const base = configuration({
    windows: [window("2026-08-30T13:30:00Z", "2026-08-30T16:00:00Z")],
  });
  const baseline = respond("grace", { ok: true, configuration: base }).etag;

  const mutations: Partial<GeofenceConfiguration>[] = [
    { churchSlug: "other" },
    { regions: [] },
    { windows: [] },
    { sources: { geofence: false, qr: false, manual: true } },
    { requiresConfirmation: false },
    { minDwellSeconds: 60 },
    { maxLocationAccuracyM: 50 },
    { configVersion: 9999 },
    { expiresAt: "2027-01-01T00:00:00.000Z" },
  ];

  for (const mutation of mutations) {
    const changed = respond("grace", {
      ok: true,
      configuration: configuration({ ...base, ...mutation }),
    }).etag;
    assert.notEqual(
      changed,
      baseline,
      `${Object.keys(mutation)[0]} is not covered by the validator`,
    );
  }
});

test("the route computes its validator over the whole body", () => {
  // The scenarios above are only meaningful if the route agrees with `respond`.
  assert.match(route, /const etag = computeEtag\(\{ church: params\.slug, data \}\)/);
  // No hand-picked subset survives.
  assert.ok(!route.includes("etagSource"), "a validator subset has returned");
});

// ---------------------------------------------------------------------------
// Church switching
// ---------------------------------------------------------------------------

test("two churches refusing for the same reason do not share a validator", () => {
  const a = respond("grace", { ok: false, reason: "consent_required" });
  const b = respond("hope", { ok: false, reason: "consent_required" });
  assert.notEqual(a.etag, b.etag);

  // And the other church's tag does not satisfy this church's request.
  const cross = respond("hope", { ok: false, reason: "consent_required" }, a.etag);
  assert.equal(cross.status, 200);
});

test("switching churches produces a different configuration and validator", () => {
  const a = respond("grace", { ok: true, configuration: configuration() });
  const b = respond(
    "hope",
    { ok: true, configuration: configuration({ churchSlug: "hope" }) },
    a.etag,
  );
  assert.equal(b.status, 200);
});

test("the configuration is scoped to the church in the path", () => {
  assert.match(source, /churchSlug: string/);
  assert.match(source, /\.from\("churches"\)[\s\S]{0,120}\.eq\("slug", churchSlug\)/);
});

test("switching churches re-runs every gate, not just the campus lookup", () => {
  assert.match(source, /resolveSelfCheckInMember\(account\.id, churchId, admin\)/);
  const churchFilters = source.match(/\.eq\("church_id", churchId\)/g) ?? [];
  assert.ok(churchFilters.length >= 3);
});

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

test("a revoked authorization changes the validator through configVersion", () => {
  // `configVersion` folds in the account's authorization version, so blocking,
  // leaving, link revocation and consent withdrawal all move it.
  assert.match(
    source,
    /Number\(policy\.policy_version \?\? 1\) \* 1000 \+ account\.authorizationVersion/,
  );

  const before = respond("grace", { ok: true, configuration: configuration() });
  const after = respond(
    "grace",
    { ok: true, configuration: configuration({ configVersion: 1008 }) },
    before.etag,
  );
  assert.equal(after.status, 200);
});

test("consent withdrawal turns a granted configuration into a refusal", () => {
  const granted = respond("grace", { ok: true, configuration: configuration() });
  const withdrawn = respond(
    "grace",
    { ok: false, reason: "consent_required" },
    granted.etag,
  );

  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.data?.configuration, null);
  assert.equal(withdrawn.data?.refusalReason, "consent_required");
});

test("a refusal that changes reason changes the validator", () => {
  const consent = respond("grace", { ok: false, reason: "consent_required" });
  const link = respond("grace", { ok: false, reason: "no_people_link" }, consent.etag);
  assert.equal(link.status, 200);
});

test("access returning is a 200, so the client re-registers", () => {
  const refused = respond("grace", { ok: false, reason: "consent_required" });
  const restored = respond(
    "grace",
    { ok: true, configuration: configuration() },
    refused.etag,
  );
  assert.equal(restored.status, 200);
  assert.ok(restored.data?.configuration);
});

test("consent and the People link are re-checked on every request", () => {
  assert.match(source, /hasAutomaticAttendanceConsent\(account\.id, admin\)/);
  assert.match(source, /return \{ ok: false, reason: "consent_required" \}/);
  assert.match(
    source,
    /reason: link\.reason === "no_people_link" \? "no_people_link" : "not_enrolled"/,
  );
});

// ---------------------------------------------------------------------------
// Cache headers and the 304 body
// ---------------------------------------------------------------------------

test("the response is private and revalidated, never shared", () => {
  assert.match(route, /cache: "private-revalidate"/);
  assert.ok(!route.includes("public-short"));
});

test("a 304 carries the validator and no body", () => {
  const first = respond("grace", { ok: true, configuration: configuration() });
  const second = respond("grace", { ok: true, configuration: configuration() }, first.etag);

  assert.equal(second.status, 304);
  assert.equal(second.data, null);
  assert.equal(second.etag, first.etag);
  assert.match(route, /mobileNotModified\(\{ requestId, cache: "private-revalidate", etag \}\)/);
});

test("the ETag is strong — a weak validator would not be sufficient here", () => {
  const etag = respond("grace", { ok: true, configuration: configuration() }).etag;
  assert.match(etag, /^"[A-Za-z0-9_-]+"$/);
  assert.ok(!etag.startsWith("W/"));
});

test("a wildcard or unrelated validator behaves correctly", () => {
  const config = { ok: true as const, configuration: configuration() };
  assert.equal(respond("grace", config, '"unrelated"').status, 200);
  assert.equal(respond("grace", config, "*").status, 304);
});

// ---------------------------------------------------------------------------
// The integrity field is gone
// ---------------------------------------------------------------------------

test("no integrity value is emitted, signed, or accepted anywhere", () => {
  // Removed rather than renamed. The client held no key to verify it with, the
  // server never accepted it back, and TLS already authenticates the transport;
  // it was a security-shaped field that checked nothing. `configVersion`
  // identifies the configuration and the ETag validates the cache.
  for (const [name, code] of [
    ["service", sourceCode],
    ["route", routeCode],
  ] as const) {
    assert.ok(!/\bintegrity\b/.test(code), `${name} still references integrity`);
    assert.ok(!code.includes("createHmac"), `${name} still signs a configuration`);
    assert.ok(!code.includes("timingSafeEqual"), `${name} still verifies a signature`);
  }

  const schema = stripComments(
    contract.slice(
      contract.indexOf("export const geofenceConfigurationSchema"),
      contract.indexOf("export const geofenceConfigResponseSchema"),
    ),
  );
  assert.ok(!schema.includes("integrity"));

  // And no environment secret is required for a configuration any more.
  assert.ok(!sourceCode.includes("ATTENDANCE_CONFIG_SECRET"));
  assert.ok(!source.includes('from "node:crypto"'), "the service no longer needs crypto");
});

test("the generated clients carry no integrity field either", () => {
  for (const path of [
    "contracts/faithful/v1/schema.json",
    "apps/faithful-ios/Sources/FaithfulKit/Generated/Contract.swift",
    "apps/faithful-android/core/contract/src/main/kotlin/io/faithform/faithful/contract/Contract.kt",
  ]) {
    const generated = readFileSync(path, "utf8");
    assert.ok(!generated.includes("integrity"), `${path} is stale`);
  }
});

// ---------------------------------------------------------------------------
// Everything the earlier pass established, unchanged
// ---------------------------------------------------------------------------

test("the configuration carries what an OS region needs", () => {
  const region = configuration().regions[0];
  assert.equal(typeof region.latitude, "number");
  assert.equal(typeof region.longitude, "number");
  assert.equal(typeof region.radiusMeters, "number");
  assert.match(region.regionId, /^faithful\.campus\./);
});

test("the region id is stable, so the OS updates rather than re-registers", () => {
  assert.match(source, /regionId: `faithful\.campus\.\$\{campus\.id as string\}`/);
});

test("regions are bounded to what a platform will accept", () => {
  assert.match(source, /\.limit\(20\)/);
  assert.match(source, /\.limit\(50\)/);
});

test("an inactive account gets no configuration", () => {
  assert.match(source, /account\.status !== "active"/);
});

test("a church with geofencing off gets no regions", () => {
  assert.match(source, /if \(!policy\?\.geofence_enabled\)/);
  assert.match(source, /reason: "geofence_disabled"/);
});

test("a hidden, inactive or unpositioned campus is never monitored", () => {
  assert.match(source, /\.eq\("is_active", true\)/);
  assert.match(source, /\.not\("latitude", "is", null\)/);
  assert.match(source, /\.not\("longitude", "is", null\)/);
  assert.match(source, /campus\.is_active && campus\.is_public/);
  assert.match(source, /reason: "no_campus_configured"/);
});

test("the configuration carries no People, staff, or credential data", () => {
  // Comment-stripped: the schema's doc comments discuss credentials in order to
  // say the field is not one.
  const schema = stripComments(
    contract.slice(
      contract.indexOf("export const geofenceConfigurationSchema"),
      contract.indexOf("export const geofenceConfigResponseSchema"),
    ),
  );
  for (const forbidden of [
    "memberId",
    "member_id",
    "accountId",
    "email",
    "phone",
    "role",
    "token",
    "secret",
    "credential",
    "churchId",
  ]) {
    assert.ok(!schema.includes(forbidden), `configuration exposes ${forbidden}`);
  }
});

test("only the caller's own church is described", () => {
  const churchFilters = source.match(/\.eq\("church_id", churchId\)/g) ?? [];
  assert.ok(churchFilters.length >= 3, "every lookup must be church-scoped");
  assert.ok(!source.includes("is_discoverable"), "other churches are not enumerated");
});

test("the module never logs", () => {
  const logs = source.match(/console\.(log|info|warn|error|debug)\(/g) ?? [];
  assert.equal(logs.length, 0, `geofence-config logs: ${logs.join(", ")}`);
});

test("submitted coordinates are still validated server-side", () => {
  const migration = readFileSync(
    "supabase/migrations/0055_attendance_authority.sql",
    "utf8",
  );
  const command = migration.slice(
    migration.indexOf("create or replace function public.record_attendance"),
    migration.indexOf("revoke all on function public.record_attendance"),
  );
  assert.match(command, /'insufficient_accuracy'/);
  assert.match(command, /'outside_region'/);
  assert.match(command, /occ\.policy_snapshot ->> 'minDwellSeconds'/);
  assert.match(command, /occ\.policy_snapshot ->> 'requiresConfirmation'/);
});

test("region monitoring exists only in the designated adapters", () => {
  // Prompt 6 asserted that region monitoring appeared *nowhere*, because
  // Prompts 7-8 owned the clients and the backend had to be provably ahead of
  // them. Prompt 7 is that arrival, so this test now asserts the stronger
  // property it was always standing in for: the framework APIs are confined to
  // the two adapter files, and every decision lives in code that has no
  // framework dependency and is therefore testable without a device.
  //
  // The service under test still contains none of it — the backend never talks
  // to Core Location or Play services.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of [
    "CLLocationManager", "CLCircularRegion", "GeofencingClient", "startMonitoring",
  ]) {
    assert.ok(!code.includes(forbidden), `the server-side service must not use ${forbidden}`);
  }

  const ALLOWED = new Set([
    // The only two production files permitted to touch a location framework.
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/CoreLocationAdapter.swift",
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
  ]);

  // Production sources only. The adapters' own tests necessarily construct the
  // framework types they translate — that is what testing a façade means, and
  // sweeping them would be a permanent false positive.
  const sourceFiles = nativeSourceFiles("apps").filter(
    (file) => !/\/(test|Tests|androidTest)\//.test(file),
  );
  assert.ok(
    sourceFiles.length > 50,
    `expected a real native tree, found ${sourceFiles.length} files`,
  );

  const offenders: string[] = [];
  for (const file of sourceFiles) {
    if (ALLOWED.has(file)) continue;

    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const stripped = text
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // Framework types only. `startMonitoring` is deliberately not in this list:
    // it is the reconciler's own abstracted method name, and forbidding it
    // outside the adapter would forbid the abstraction itself.
    for (const forbidden of ["CLLocationManager", "CLCircularRegion", "GeofencingClient"]) {
      if (stripped.includes(forbidden)) offenders.push(`${file}: ${forbidden}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a location framework escaped its adapter: ${offenders.join(", ")}`,
  );

  // And both adapters really are in the swept set — an over-broad exclusion
  // would make this pass by checking nothing.
  assert.ok(
    nativeSourceFiles("apps").some((f) => f.endsWith("CoreLocationAdapter.swift")),
  );
  assert.ok(
    nativeSourceFiles("apps").some((f) => f.endsWith("PlayServicesGeofencing.kt")),
  );
});

test("the adapters are thin — no decisions leaked into them", () => {
  // The abstraction only pays for itself if the framework files translate and
  // nothing more. A refusal reason or a policy threshold appearing here would
  // mean a rule that no test can reach without a device.
  for (const path of [
    "apps/faithful-ios/Sources/FaithfulKit/Attendance/CoreLocationAdapter.swift",
    "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
  ]) {
    const code = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const decision of [
      "consent", "occurrence", "idempotenc", "authorizationVersion",
      "minDwellSeconds", "requiresConfirmation", "no_people_link",
    ]) {
      assert.ok(
        !code.includes(decision),
        `${path} contains a decision it should not: ${decision}`,
      );
    }
  }
});

test("background location is declared once, in the manifest, and nowhere else", () => {
  // It is a real permission this feature genuinely needs, so it is declared —
  // but only in the manifest and in the permission check that reads it back.
  const files = nativeSourceFiles("apps").filter((file) => {
    // Production only: the Robolectric suite grants and revokes this
    // permission in order to assert the app handles both, which necessarily
    // names it.
    if (/\/(test|Tests|androidTest)\//.test(file)) return false;
    const text = readFileSync(file, "utf8");
    return text
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .includes("ACCESS_BACKGROUND_LOCATION");
  });

  assert.deepEqual(
    files.sort(),
    [
      "apps/faithful-android/app/src/main/AndroidManifest.xml",
      "apps/faithful-android/app/src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
    ],
    "background location must not spread beyond the manifest and its checker",
  );
});
