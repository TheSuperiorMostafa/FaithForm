import assert from "node:assert/strict";
import test from "node:test";

import {
  generateInvitationToken,
  hashInvitationToken,
  invitationHashesMatch,
  invitationExpiry,
  buildInvitationPath,
} from "@/lib/faithful/invitation-token";
import {
  campusSchema,
  discoverySearchSchema,
  claimRequestSchema,
  invitationSchema,
  isValidTimeZone,
  normalizeEmail,
  normalizePhone,
  pageSchema,
  MAX_PAGE_SIZE,
} from "@/lib/faithful/schemas";

// ---------------------------------------------------------------------------
// Invitation tokens
// ---------------------------------------------------------------------------

test("invitation tokens are high-entropy and never repeat", () => {
  const tokens = new Set<string>();
  for (let i = 0; i < 200; i++) tokens.add(generateInvitationToken());
  assert.equal(tokens.size, 200);
  // 32 bytes base64url encodes to 43 characters.
  assert.ok(generateInvitationToken().length >= 43);
});

test("only the hash is ever suitable for storage, and it is deterministic", () => {
  const token = generateInvitationToken();
  const hash = hashInvitationToken(token);
  assert.equal(hash, hashInvitationToken(token));
  assert.notEqual(hash, token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(token));
});

test("hash comparison is length-safe and rejects near matches", () => {
  const hash = hashInvitationToken("a");
  assert.equal(invitationHashesMatch(hash, hashInvitationToken("a")), true);
  assert.equal(invitationHashesMatch(hash, hashInvitationToken("b")), false);
  assert.equal(invitationHashesMatch(hash, hash.slice(0, 40)), false);
});

test("an invitation link carries the token in the path, never a query string", () => {
  const path = buildInvitationPath("abc-123");
  assert.equal(path, "/faithful/invite/abc-123");
  assert.ok(!path.includes("?"));
});

test("expiry is a real future instant", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(
    invitationExpiry(14, now).toISOString(),
    "2026-01-15T00:00:00.000Z",
  );
});

// ---------------------------------------------------------------------------
// Contact normalization is not matching
// ---------------------------------------------------------------------------

test("email and phone normalize for display, and reject junk", () => {
  assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizePhone("(502) 555-0134"), "+15025550134");
  assert.equal(normalizePhone("nonsense"), null);
});

test("two unrelated people may normalize to the same contact value", () => {
  // A shared household phone is ordinary. Normalization must not be treated as
  // identity anywhere — this asserts the values collide so the rest of the
  // system is obliged to resolve it with a human decision.
  assert.equal(normalizePhone("502-555-0134"), normalizePhone("+1 502 555 0134"));
  assert.equal(normalizeEmail("FAMILY@x.com"), normalizeEmail("family@x.com"));
});

// ---------------------------------------------------------------------------
// Dependent claims fail closed
// ---------------------------------------------------------------------------

test("a claim may name another person only as an explicit, rejectable field", () => {
  const parsed = claimRequestSchema.safeParse({
    churchSlug: "grace",
    onBehalfOfMemberId: "11111111-1111-4111-8111-111111111111",
  });
  // The schema accepts it so the service can refuse it with a specific error,
  // rather than stripping it and silently treating it as a self-claim.
  assert.equal(parsed.success, true);
  assert.equal(
    parsed.success && parsed.data.onBehalfOfMemberId,
    "11111111-1111-4111-8111-111111111111",
  );
});

// ---------------------------------------------------------------------------
// Bounded pagination
// ---------------------------------------------------------------------------

test("page size is bounded and defaulted, never unbounded", () => {
  assert.equal(pageSchema.parse({}).limit, 20);
  assert.equal(pageSchema.safeParse({ limit: 5000 }).success, false);
  assert.equal(pageSchema.safeParse({ limit: 0 }).success, false);
  assert.equal(pageSchema.parse({ limit: MAX_PAGE_SIZE }).limit, MAX_PAGE_SIZE);
});

test("discovery search bounds its query and keeps a keyset cursor", () => {
  const parsed = discoverySearchSchema.parse({
    query: "grace",
    cursorName: "Grace Community",
    cursorId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(parsed.limit, 20);
  assert.equal(parsed.cursorName, "Grace Community");
  assert.equal(
    discoverySearchSchema.safeParse({ query: "x".repeat(500) }).success,
    false,
  );
  assert.equal(discoverySearchSchema.safeParse({ cursorId: "nope" }).success, false);
});

// ---------------------------------------------------------------------------
// Campus validation
// ---------------------------------------------------------------------------

const validCampus = {
  name: "East Campus",
  slug: "east-campus",
  timezone: "America/New_York",
  latitude: 38.2527,
  longitude: -85.7585,
  geofenceRadiusM: 150,
};

test("a valid campus passes and defaults sensibly", () => {
  const parsed = campusSchema.parse(validCampus);
  assert.equal(parsed.isActive, true);
  assert.equal(parsed.isPublic, true);
  assert.equal(parsed.country, "US");
  assert.equal(parsed.geofenceRadiusM, 150);
});

test("coordinates must be supplied as a pair or not at all", () => {
  assert.equal(
    campusSchema.safeParse({ ...validCampus, longitude: null }).success,
    false,
  );
  assert.equal(
    campusSchema.safeParse({ ...validCampus, latitude: null }).success,
    false,
  );
  assert.equal(
    campusSchema.safeParse({
      ...validCampus,
      latitude: null,
      longitude: null,
    }).success,
    true,
  );
});

test("out-of-range coordinates are rejected", () => {
  assert.equal(campusSchema.safeParse({ ...validCampus, latitude: 91 }).success, false);
  assert.equal(campusSchema.safeParse({ ...validCampus, latitude: -91 }).success, false);
  assert.equal(campusSchema.safeParse({ ...validCampus, longitude: 181 }).success, false);
  assert.equal(campusSchema.safeParse({ ...validCampus, longitude: -181 }).success, false);
});

test("geofence radius stays inside a sane band", () => {
  assert.equal(
    campusSchema.safeParse({ ...validCampus, geofenceRadiusM: 10 }).success,
    false,
  );
  assert.equal(
    campusSchema.safeParse({ ...validCampus, geofenceRadiusM: 5000 }).success,
    false,
  );
  assert.equal(
    campusSchema.safeParse({ ...validCampus, geofenceRadiusM: 25 }).success,
    true,
  );
  assert.equal(
    campusSchema.safeParse({ ...validCampus, geofenceRadiusM: 2000 }).success,
    true,
  );
});

test("timezones are validated as real IANA zones, including DST-relevant ones", () => {
  for (const zone of [
    "America/New_York",
    "America/Chicago",
    "America/Phoenix",
    "Pacific/Honolulu",
    "Europe/London",
    "Australia/Lord_Howe",
  ]) {
    assert.equal(isValidTimeZone(zone), true, zone);
    assert.equal(campusSchema.safeParse({ ...validCampus, timezone: zone }).success, true, zone);
  }

  for (const zone of ["Not/AZone", "EST5EDT-bogus", "", "America/Atlantis"]) {
    assert.equal(campusSchema.safeParse({ ...validCampus, timezone: zone }).success, false, zone);
  }
});

test("a DST boundary is handled by the zone, not by a stored offset", () => {
  // Louisville and Phoenix diverge across a DST boundary. Storing the zone
  // rather than an offset is what makes that correct later.
  const winter = new Date("2026-01-15T18:00:00Z");
  const summer = new Date("2026-07-15T18:00:00Z");
  const hour = (date: Date, timeZone: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(date);

  assert.notEqual(hour(winter, "America/New_York"), hour(summer, "America/New_York"));
  assert.equal(hour(winter, "America/Phoenix"), hour(summer, "America/Phoenix"));
});

test("campus slug rejects characters that would break a public URL", () => {
  for (const slug of ["East Campus", "EAST", "east_campus", "-east", "east/campus"]) {
    assert.equal(campusSchema.safeParse({ ...validCampus, slug }).success, false, slug);
  }
  assert.equal(campusSchema.safeParse({ ...validCampus, slug: "east-2" }).success, true);
});

// ---------------------------------------------------------------------------
// Invitation payloads
// ---------------------------------------------------------------------------

test("invitation expiry and use count are bounded", () => {
  assert.equal(invitationSchema.parse({ purpose: "join" }).expiresInDays, 14);
  assert.equal(invitationSchema.parse({ purpose: "join" }).maxUses, 1);
  assert.equal(invitationSchema.safeParse({ purpose: "join", expiresInDays: 0 }).success, false);
  assert.equal(invitationSchema.safeParse({ purpose: "join", expiresInDays: 400 }).success, false);
  assert.equal(invitationSchema.safeParse({ purpose: "join", maxUses: 0 }).success, false);
  assert.equal(invitationSchema.safeParse({ purpose: "staff" }).success, false);
});
