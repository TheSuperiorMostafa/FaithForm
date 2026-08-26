import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  CONTRACT_ENUMS,
  CONTRACT_SCHEMAS,
  bootstrapSchema,
  failureSchema,
  attendanceAttemptRequestSchema,
  attendanceConsentResultSchema,
  attendanceResultSchema,
  geofenceConfigResponseSchema,
  healthSchema,
  relationshipPageSchema,
} from "@/lib/mobile/v1/contract";
import {
  MOBILE_ERROR_CODES,
  MobileError,
  isRetryable,
  mobileCodeForDomainCode,
  statusForCode,
} from "@/lib/mobile/v1/errors";
import {
  computeEtag,
  decodeCursor,
  encodeCursor,
  etagMatches,
  parseLimit,
  requireIdempotencyKey,
  readJsonBody,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
} from "@/lib/mobile/v1/protocol";
import { mobileFailure, mobileSuccess, newRequestId } from "@/lib/mobile/v1/envelope";

const FIXTURE_DIR = "contracts/faithful/v1/fixtures";
const fixtureNames = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""))
  .sort();

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8"));

// ---------------------------------------------------------------------------
// Fixture parity — the same files Swift and Kotlin decode
// ---------------------------------------------------------------------------

test("the fixture set is non-empty and covers both outcomes", () => {
  assert.ok(fixtureNames.length >= 20, `only ${fixtureNames.length} fixtures`);
  assert.ok(fixtureNames.some((name) => name.startsWith("bootstrap-")));
  assert.ok(fixtureNames.filter((name) => name.startsWith("error-")).length >= 10);
});

test("every bootstrap fixture validates against the canonical schema", () => {
  for (const name of fixtureNames.filter((n) => n.startsWith("bootstrap-"))) {
    const parsed = bootstrapSchema.safeParse(fixture(name).data);
    assert.ok(parsed.success, `${name}: ${parsed.error?.message}`);
  }
});

test("every error fixture validates and carries a correlation id", () => {
  for (const name of fixtureNames.filter((n) => n.startsWith("error-"))) {
    const body = fixture(name);
    assert.equal(body.ok, false, name);
    assert.ok(body.meta.requestId, `${name} lacks a request id`);
    assert.equal(typeof body.error.retryable, "boolean", name);
  }
});

test("a future error code is tolerated by the envelope shape", () => {
  const body = fixture("error-unknown-future-code");
  // The strict schema rejects it, which is correct for the server; what matters
  // is that the *envelope* is still well-formed so a client can degrade.
  assert.equal(failureSchema.safeParse(body).success, false);
  assert.ok(body.error.code);
  assert.ok(body.meta.apiVersion);
});

test("pagination fixtures validate and terminate", () => {
  assert.ok(relationshipPageSchema.safeParse(fixture("relationship-page-first").data).success);
  const last = relationshipPageSchema.parse(fixture("relationship-page-last").data);
  assert.equal(last.nextCursor, null);
});

test("every geofence-config fixture validates against the canonical schema", () => {
  const names = fixtureNames.filter((name) => name.startsWith("geofence-config-"));
  assert.ok(names.length >= 3, `only ${names.length} geofence fixtures`);

  for (const name of names) {
    const parsed = geofenceConfigResponseSchema.safeParse(fixture(name).data);
    assert.ok(parsed.success, `${name}: ${parsed.error?.message}`);
  }
});

test("a granted geofence configuration carries what an OS region needs", () => {
  const data = geofenceConfigResponseSchema.parse(fixture("geofence-config-granted").data);
  assert.ok(data.configuration);

  for (const region of data.configuration!.regions) {
    assert.equal(typeof region.latitude, "number");
    assert.equal(typeof region.longitude, "number");
    assert.ok(region.radiusMeters > 0);
    assert.match(region.regionId, /^faithful\.campus\./);
  }
});

test("no geofence fixture carries an integrity field", () => {
  // The HMAC `integrity` value was removed from the contract: the client had no
  // key to verify it with, the server never accepted it back, and TLS already
  // authenticates the transport. A fixture reintroducing it would mean the
  // contract had drifted back.
  for (const name of fixtureNames.filter((n) => n.startsWith("geofence-config-"))) {
    const serialized = JSON.stringify(fixture(name));
    assert.ok(!serialized.includes("integrity"), `${name} still carries integrity`);
  }
});

test("a granted configuration expires on a boundary, not on an arrival time", () => {
  const data = geofenceConfigResponseSchema.parse(fixture("geofence-config-granted").data);
  const expiry = data.configuration!.expiresAt;

  // The fixture's expiry is a check-in window boundary — which is what the
  // deterministic algorithm produces when a window opens before the next
  // revalidation bucket ends. A `now + TTL` value could not land on one.
  const boundaries = data.configuration!.windows.flatMap((w) => [
    w.checkinOpensAt,
    w.checkinClosesAt,
  ]);
  assert.ok(
    boundaries.includes(expiry),
    `${expiry} is not a window boundary; the expiry looks arrival-derived`,
  );
});

test("a refused geofence configuration carries a reason and no geometry", () => {
  for (const name of ["geofence-config-refused-consent", "geofence-config-refused-link"]) {
    const data = geofenceConfigResponseSchema.parse(fixture(name).data);
    assert.equal(data.configuration, null);
    assert.ok(data.refusalReason);
    assert.ok(data.message && data.message.length > 0);

    // A refusal must not leak the configuration it is refusing to describe.
    const serialized = JSON.stringify(data).toLowerCase();
    for (const term of ["latitude", "longitude", "radius", "campus"]) {
      assert.ok(!serialized.includes(term), `${name} leaks ${term}`);
    }
  }
});

test("every attendance-result variant decodes", () => {
  const names = fixtureNames.filter((n) => n.startsWith("attendance-result-"));
  assert.ok(names.length >= 4, `only ${names.length} result fixtures`);

  const outcomes = new Set<string>();
  for (const name of names) {
    const parsed = attendanceResultSchema.safeParse(fixture(name).data);
    assert.ok(parsed.success, `${name}: ${parsed.error?.message}`);
    outcomes.add(parsed.data!.outcome);
  }

  // The four a native client actually has to handle differently.
  for (const outcome of ["counted", "already_counted", "pending_confirmation", "rejected"]) {
    assert.ok(outcomes.has(outcome), `no fixture covers ${outcome}`);
  }
});

test("a rejected result never explains why the location failed", () => {
  // The message is shown to a person. It must not become a spoofing oracle by
  // saying which check failed — "you were 40 m too far" is a hint.
  const data = attendanceResultSchema.parse(fixture("attendance-result-rejected").data);
  const message = data.message.toLowerCase();
  for (const leak of [
    "metre", "meter", "radius", "distance", "accuracy", "dwell",
    "geofence", "region", "coordinate", "gps",
  ]) {
    assert.ok(!message.includes(leak), `rejection message leaks "${leak}"`);
  }
});

test("only a counted or already-counted result carries a countedAt", () => {
  for (const name of ["attendance-result-counted", "attendance-result-already-counted"]) {
    assert.ok(attendanceResultSchema.parse(fixture(name).data).countedAt);
  }
  for (const name of ["attendance-result-pending", "attendance-result-rejected"]) {
    assert.equal(attendanceResultSchema.parse(fixture(name).data).countedAt, null);
  }
});

test("consent results decode and carry the version to re-partition against", () => {
  for (const name of ["attendance-consent-granted", "attendance-consent-revoked"]) {
    const parsed = attendanceConsentResultSchema.safeParse(fixture(name).data);
    assert.ok(parsed.success, `${name}: ${parsed.error?.message}`);
    assert.ok(parsed.data!.authorizationVersion > 0);
  }

  // A withdrawal moves the version, which is what invalidates a device's
  // cached "allowed" decision.
  const granted = attendanceConsentResultSchema.parse(fixture("attendance-consent-granted").data);
  const revoked = attendanceConsentResultSchema.parse(fixture("attendance-consent-revoked").data);
  assert.ok(revoked.authorizationVersion > granted.authorizationVersion);
});

test("the attempt request rejects malformed or out-of-range evidence", () => {
  const valid = {
    occurrenceId: "occ-1",
    source: "geofence",
    phase: "confirm",
    accuracyMeters: 12,
    dwellSeconds: 180,
    latitude: 38.2527,
    longitude: -85.7585,
  };
  assert.ok(attendanceAttemptRequestSchema.safeParse(valid).success);

  // Coordinates are bounded to real values.
  for (const bad of [
    { ...valid, latitude: 91 },
    { ...valid, latitude: -91 },
    { ...valid, longitude: 181 },
    { ...valid, longitude: -181 },
    { ...valid, latitude: "38.25" },
    { ...valid, source: "manual" },
    { ...valid, source: "kiosk" },
    { ...valid, phase: "counted" },
    { ...valid, dwellSeconds: 1.5 },
    { occurrenceId: "occ-1" },
  ]) {
    assert.equal(
      attendanceAttemptRequestSchema.safeParse(bad).success,
      false,
      `accepted malformed evidence: ${JSON.stringify(bad)}`,
    );
  }
});

test("an attempt with no coordinates is valid and fails closed server-side", () => {
  // A phone that could not get a fix still submits. The server bands the
  // absence `unknown` and refuses — the client does not guess a position, and
  // does not silently skip the attempt either.
  const parsed = attendanceAttemptRequestSchema.safeParse({
    occurrenceId: "occ-1",
    source: "geofence",
    phase: "confirm",
    dwellSeconds: 180,
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data!.latitude, undefined);
});

test("health carries no provider or configuration value", () => {
  const data = healthSchema.parse(fixture("health").data);
  const serialized = JSON.stringify(data).toLowerCase();
  for (const term of ["supabase", "stripe", "postgres", "secret", "http"]) {
    assert.ok(!serialized.includes(term), `health leaks ${term}`);
  }
});

test("no fixture exposes a sensitive field name", () => {
  // Asserted on JSON keys, not substrings: `weeklyEmail` is a preference.
  const forbidden = new Set([
    "accesstoken", "refreshtoken", "servicerole", "apikey", "secret",
    "clientsecret", "publishkey", "streamkey", "token",
    "memberid", "peopleid", "churchid", "accountid", "userid",
    "email", "phone", "latitude", "longitude",
    "role", "featurepermissions", "stripecustomerid",
  ]);

  /**
   * The one place coordinates are allowed, and only there.
   *
   * This guard exists to stop **a person's** data reaching a payload. A campus
   * centre is not that: it is a fact about a building the church publishes on
   * its own website, and an OS geofence cannot be registered without it.
   *
   * The exception is deliberately a *path*, not a removal from the set. A
   * latitude anywhere else in any fixture — attached to an account, a member, a
   * relationship, an attendance attempt — still fails, which is the case that
   * actually matters. Matching the whole path also means a future payload that
   * nests a person under `configuration.regions` would not inherit the licence.
   */
  const CAMPUS_GEOMETRY = /^[^.]+\.data\.configuration\.regions\[\d+\]\.(latitude|longitude)$/;

  const exempted: string[] = [];

  const walk = (node: unknown, path: string, name: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`, name));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const full = `${path}.${key}`;
        if (forbidden.has(key.toLowerCase())) {
          assert.ok(CAMPUS_GEOMETRY.test(full), `fixture ${name} exposes ${full}`);
          exempted.push(full);
        }
        walk(child, full, name);
      }
    }
  };

  for (const name of fixtureNames) walk(fixture(name), name, name);

  // Every exemption used must be a campus centre in a geofence fixture, and
  // nothing else may have quietly started relying on the carve-out.
  for (const path of exempted) {
    assert.match(path, /^geofence-config-/, `unexpected geometry exemption at ${path}`);
  }
  assert.ok(exempted.length > 0, "the geofence fixture should exercise the exemption");
});

test("the coordinate exemption does not extend to people", () => {
  // The carve-out above is path-scoped. Proving it bites matters more than the
  // green: a coordinate hung off anything other than a campus region must fail.
  const forbidden = new Set(["latitude", "longitude"]);
  const CAMPUS_GEOMETRY = /^[^.]+\.data\.configuration\.regions\[\d+\]\.(latitude|longitude)$/;

  const offending = [
    "f.data.configuration.regions[0].member.latitude",
    "f.data.account.latitude",
    "f.data.configuration.latitude",
    "f.data.attempt.regions[0].latitude",
  ];
  for (const path of offending) {
    assert.equal(CAMPUS_GEOMETRY.test(path), false, `${path} must not be exempt`);
  }

  // And the legitimate one still is.
  assert.ok(CAMPUS_GEOMETRY.test("geofence-config-granted.data.configuration.regions[1].longitude"));
  assert.ok(forbidden.has("latitude"));
});

// ---------------------------------------------------------------------------
// Error vocabulary
// ---------------------------------------------------------------------------

test("every error code maps to exactly one status", () => {
  for (const [code, status] of Object.entries(MOBILE_ERROR_CODES)) {
    assert.equal(statusForCode(code as never), status);
    assert.ok(status >= 400 && status < 600, `${code} -> ${status}`);
  }
});

test("only transient codes are advertised as retryable", () => {
  assert.ok(isRetryable("rate_limited"));
  assert.ok(isRetryable("unavailable"));
  assert.ok(isRetryable("internal_error"));
  for (const code of ["forbidden", "blocked", "conflict", "invalid_request", "not_found"] as const) {
    assert.equal(isRetryable(code), false, code);
  }
});

test("an unmapped domain code degrades to internal_error, never leaking its name", () => {
  assert.equal(mobileCodeForDomainCode("blocked"), "blocked");
  assert.equal(mobileCodeForDomainCode("member_already_claimed"), "conflict");
  assert.equal(mobileCodeForDomainCode("some_internal_thing"), "internal_error");
});

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

test("a cursor round-trips and is opaque", () => {
  const cursor = encodeCursor("relationships", ["abc"]);
  assert.deepEqual(decodeCursor(cursor, "relationships"), ["abc"]);
  assert.ok(!cursor.includes("abc"), "cursor must not be readable");
});

test("a cursor minted for one list cannot be replayed against another", () => {
  const cursor = encodeCursor("relationships", ["abc"]);
  assert.throws(() => decodeCursor(cursor, "churches"), MobileError);
});

test("malformed and oversized cursors are rejected", () => {
  for (const bad of ["not-base64!", "e30=", "x".repeat(600), Buffer.from("[]").toString("base64url")]) {
    assert.throws(() => decodeCursor(bad, "relationships"), MobileError, bad.slice(0, 20));
  }
  assert.equal(decodeCursor(null, "relationships"), null);
  assert.equal(decodeCursor(undefined, "relationships"), null);
});

test("page limits are bounded and defaulted", () => {
  assert.equal(parseLimit(null), DEFAULT_PAGE_LIMIT);
  assert.equal(parseLimit(""), DEFAULT_PAGE_LIMIT);
  assert.equal(parseLimit("10"), 10);
  assert.equal(parseLimit(String(MAX_PAGE_LIMIT)), MAX_PAGE_LIMIT);
  for (const bad of ["0", "-1", "51", "1000", "abc", "1.5"]) {
    assert.throws(() => parseLimit(bad), MobileError, bad);
  }
});

// ---------------------------------------------------------------------------
// ETags
// ---------------------------------------------------------------------------

test("an ETag is stable for identical content and differs otherwise", () => {
  const a = computeEtag({ x: 1, y: [1, 2] });
  assert.equal(a, computeEtag({ x: 1, y: [1, 2] }));
  assert.notEqual(a, computeEtag({ x: 2, y: [1, 2] }));
  assert.match(a, /^"[A-Za-z0-9_-]{32}"$/);
});

test("If-None-Match handles exact, weak, list and wildcard forms", () => {
  const etag = computeEtag({ x: 1 });
  assert.ok(etagMatches(etag, etag));
  assert.ok(etagMatches(`W/${etag}`, etag));
  assert.ok(etagMatches(`"other", ${etag}`, etag));
  assert.ok(etagMatches("*", etag));
  assert.equal(etagMatches('"nope"', etag), false);
  assert.equal(etagMatches(null, etag), false);
  assert.equal(etagMatches(undefined, etag), false);
});

// ---------------------------------------------------------------------------
// Idempotency and body limits
// ---------------------------------------------------------------------------

test("a retryable command requires a well-formed idempotency key", () => {
  const withKey = new Request("https://x.invalid", {
    headers: { "Idempotency-Key": "abc-12345678" },
  });
  assert.equal(requireIdempotencyKey(withKey), "abc-12345678");

  assert.throws(() => requireIdempotencyKey(new Request("https://x.invalid")), MobileError);

  for (const bad of ["short", "x".repeat(200), "has space", "has/slash"]) {
    const request = new Request("https://x.invalid", { headers: { "Idempotency-Key": bad } });
    assert.throws(() => requireIdempotencyKey(request), MobileError, bad);
  }
});

test("oversized bodies are refused before being parsed", async () => {
  const huge = JSON.stringify({ value: "x".repeat(20_000) });
  const request = new Request("https://x.invalid", { method: "POST", body: huge });
  await assert.rejects(() => readJsonBody(request), MobileError);
});

test("malformed JSON is refused with a safe message", async () => {
  const request = new Request("https://x.invalid", { method: "POST", body: "{not json" });
  await assert.rejects(
    () => readJsonBody(request),
    (error: unknown) =>
      error instanceof MobileError &&
      error.code === "invalid_request" &&
      !error.message.includes("not json"),
  );
});

test("an empty body is an empty object, not an error", async () => {
  const request = new Request("https://x.invalid", { method: "POST" });
  assert.deepEqual(await readJsonBody(request), {});
});

// ---------------------------------------------------------------------------
// Envelope and cache semantics
// ---------------------------------------------------------------------------

test("a correlation id is unique and carries nothing about the caller", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
  assert.equal(ids.size, 200);
  assert.match(newRequestId(), /^[0-9a-f-]{36}$/);
});

test("private responses are never storable and always vary on Authorization", async () => {
  const requestId = newRequestId();
  const response = mobileSuccess({ x: 1 }, { requestId, cache: "private-no-store" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Vary") ?? "", /Authorization/);
  assert.equal(response.headers.get("X-Request-Id"), requestId);
});

test("revalidatable private responses stay out of shared caches", () => {
  const response = mobileSuccess({ x: 1 }, {
    requestId: newRequestId(),
    cache: "private-revalidate",
    etag: '"abc"',
  });
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  assert.match(cacheControl, /private/);
  assert.match(cacheControl, /no-cache/);
  assert.equal(response.headers.get("ETag"), '"abc"');
});

test("public responses may be shared but only briefly", () => {
  const response = mobileSuccess({ x: 1 }, { requestId: newRequestId(), cache: "public-short" });
  assert.match(response.headers.get("Cache-Control") ?? "", /public, max-age=60/);
});

test("an error response is never cached, even on a cacheable route", async () => {
  const response = mobileFailure(new MobileError("rate_limited", "slow down", { retryAfterSeconds: 30 }), {
    requestId: newRequestId(),
    cache: "public-short",
    etag: '"abc"',
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("ETag"), null);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.status, 429);

  const body = await response.json();
  assert.equal(body.error.retryable, true);
});

// ---------------------------------------------------------------------------
// Schema hygiene
// ---------------------------------------------------------------------------

test("the generated JSON Schema matches the registered schemas", () => {
  const schema = JSON.parse(readFileSync("contracts/faithful/v1/schema.json", "utf8"));
  const declared = Object.keys(CONTRACT_SCHEMAS).sort();
  const generated = Object.keys(schema.$defs).sort();
  assert.deepEqual(generated, declared);
});

test("no contract schema declares a sensitive field", () => {
  const schema = JSON.parse(readFileSync("contracts/faithful/v1/schema.json", "utf8"));
  const serialized = JSON.stringify(schema).toLowerCase();
  for (const term of [
    "accesstoken", "refreshtoken", "servicerole", "apikey",
    "memberid", "peopleid", "churchid", "stripecustomerid", "featurepermissions",
  ]) {
    assert.ok(!serialized.includes(term), `schema declares ${term}`);
  }
});

test("enums are non-empty and stable", () => {
  for (const [name, values] of Object.entries(CONTRACT_ENUMS)) {
    assert.ok(values.length > 0, `${name} is empty`);
    assert.equal(new Set(values).size, values.length, `${name} has duplicates`);
  }
});

test("a string literal generates a String, not a Bool", () => {
  // Regression. The generator mapped **every** `const` to a boolean, which was
  // accidentally right while the only consts were `ok: true` on the envelopes.
  // Prompt 9's `z.literal("recording")` produced a Swift `Bool` that compiled
  // and then failed to decode at run time — caught by a fixture test, not by
  // reading the generator.
  const swift = readFileSync(
    "apps/faithful-ios/Sources/FaithfulKit/Generated/Contract.swift",
    "utf8",
  );
  const kotlin = readFileSync(
    "apps/faithful-android/core/contract/src/main/kotlin/io/faithform/faithful/contract/Contract.kt",
    "utf8",
  );

  const swiftArchive = swift.slice(
    swift.indexOf("public struct ArchiveItem"),
    swift.indexOf("public struct MediaPage"),
  );
  const kotlinArchive = kotlin.slice(
    kotlin.indexOf("data class ArchiveItem"),
    kotlin.indexOf("data class MediaPage"),
  );
  assert.ok(swiftArchive.length > 100 && kotlinArchive.length > 100);

  assert.match(swiftArchive, /public let kind: String/);
  assert.match(kotlinArchive, /val kind: String/);
  assert.doesNotMatch(swiftArchive, /public let kind: Bool/);
  assert.doesNotMatch(kotlinArchive, /val kind: Boolean/);

  // And the boolean consts that were always correct still are.
  assert.match(swift, /public let ok: Bool/);
});

test("the media contract carries no provider or storage detail", () => {
  const schema = JSON.parse(readFileSync("contracts/faithful/v1/schema.json", "utf8"));
  const media = JSON.stringify([
    schema.$defs.ArchiveItem,
    schema.$defs.MediaDetail,
    schema.$defs.LiveMedia,
    schema.$defs.PlaybackGrant,
  ]);

  for (const forbidden of [
    "storagePath", "storage_path", "bucket", "signedUrl", "providerId",
    "streamPath", "streamKey", "publishKey", "ingest", "relay",
  ]) {
    assert.ok(!media.includes(forbidden), `the media contract exposes ${forbidden}`);
  }
});

test("every enum value is snake_case, so a generated name is never run together", () => {
  // `requiresAction` generated `REQUIRESACTION` in Kotlin — valid, unreadable,
  // and one letter away from ambiguous. Every other enum in this contract is
  // snake_case, and the generator turns that into `REQUIRES_ACTION` on both
  // platforms. Caught by compiling Kotlin, which is a slow way to find a naming
  // convention; this is the fast one.
  for (const [name, values] of Object.entries(CONTRACT_ENUMS)) {
    for (const value of values as readonly string[]) {
      assert.ok(
        /^[a-z0-9]+(_[a-z0-9]+)*$/.test(value),
        `${name} carries "${value}", which is not snake_case`,
      );
    }
  }
});
