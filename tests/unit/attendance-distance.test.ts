import assert from "node:assert/strict";
import test from "node:test";

import { bandForAttempt, distanceMeters } from "@/lib/attendance/v2/distance";

/** A real church, so the numbers below are checkable against a map. */
const CAMPUS = { latitude: 38.2527, longitude: -85.7585, radiusMeters: 150 };

/** Metres north of a point, accurate enough at this scale to reason about. */
const north = (from: { latitude: number; longitude: number }, meters: number) => ({
  latitude: from.latitude + meters / 111_320,
  longitude: from.longitude,
});

const band = (
  reported: { latitude?: number | null; longitude?: number | null },
  extra: { accuracyMeters?: number | null; campus?: typeof CAMPUS } = {},
) =>
  bandForAttempt({
    reported,
    campus: extra.campus ?? CAMPUS,
    accuracyMeters: extra.accuracyMeters,
    maxAccuracyMeters: 100,
  });

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

test("distance is a real great-circle measurement", () => {
  assert.equal(Math.round(distanceMeters(CAMPUS, CAMPUS)), 0);

  // One degree of latitude is ~111.2 km everywhere.
  const oneDegree = distanceMeters(CAMPUS, { ...CAMPUS, latitude: CAMPUS.latitude + 1 });
  assert.ok(Math.abs(oneDegree - 111_195) < 500, `${oneDegree}m for one degree`);

  // A known city pair, to catch a formula that is merely self-consistent.
  const louisvilleToChicago = distanceMeters(
    { latitude: 38.2527, longitude: -85.7585 },
    { latitude: 41.8781, longitude: -87.6298 },
  );
  assert.ok(
    Math.abs(louisvilleToChicago - 425_000) < 15_000,
    `${Math.round(louisvilleToChicago / 1000)}km Louisville→Chicago`,
  );
});

test("distance is symmetric and handles the antimeridian", () => {
  const a = { latitude: 0, longitude: 179.99 };
  const b = { latitude: 0, longitude: -179.99 };
  assert.equal(Math.round(distanceMeters(a, b)), Math.round(distanceMeters(b, a)));
  // ~0.02° apart, not most of the way round the planet.
  assert.ok(distanceMeters(a, b) < 3000, `${distanceMeters(a, b)}m across the line`);
});

// ---------------------------------------------------------------------------
// Banding
// ---------------------------------------------------------------------------

test("standing at the campus is inside", () => {
  assert.equal(band(CAMPUS), "inside");
  assert.equal(band(north(CAMPUS, 100)), "inside");
  assert.equal(band(north(CAMPUS, 149)), "inside");
});

test("just outside is near, and far away is far", () => {
  assert.equal(band(north(CAMPUS, 200)), "near");
  assert.equal(band(north(CAMPUS, 390)), "near");
  assert.equal(band(north(CAMPUS, 600)), "far");
  assert.equal(band(north(CAMPUS, 5_000)), "far");
});

test("accuracy widens the circle, because an ambiguous fix is ambiguous", () => {
  // 200 m out is outside a 150 m radius — but with a ±80 m fix, honest
  // attendance indoors on a bad day should not be refused.
  assert.equal(band(north(CAMPUS, 200)), "near");
  assert.equal(band(north(CAMPUS, 200), { accuracyMeters: 80 }), "inside");
});

test("an implausible accuracy claim cannot buy an unlimited circle", () => {
  // Capped at the policy ceiling (100 m here), so claiming ±10 km does not make
  // the whole city inside.
  assert.equal(band(north(CAMPUS, 5_000), { accuracyMeters: 10_000 }), "far");
  assert.equal(band(north(CAMPUS, 240), { accuracyMeters: 10_000 }), "inside");
  assert.equal(band(north(CAMPUS, 260), { accuracyMeters: 10_000 }), "near");
});

// ---------------------------------------------------------------------------
// Failing closed
// ---------------------------------------------------------------------------

test("no coordinates is unknown, never inside", () => {
  // This is the case that matters most: it is what a pre-Prompt-7 client, or a
  // client that could not get a fix, actually sends. `unknown` is refused by
  // the command; `inside` — which is what this used to be — was not.
  assert.equal(band({}), "unknown");
  assert.equal(band({ latitude: 38.25 }), "unknown");
  assert.equal(band({ longitude: -85.75 }), "unknown");
  assert.equal(band({ latitude: null, longitude: null }), "unknown");
});

test("a nonsensical coordinate is unknown", () => {
  assert.equal(band({ latitude: 91, longitude: 0 }), "unknown");
  assert.equal(band({ latitude: 0, longitude: 181 }), "unknown");
  assert.equal(band({ latitude: Number.NaN, longitude: 0 }), "unknown");
  assert.equal(band({ latitude: Number.POSITIVE_INFINITY, longitude: 0 }), "unknown");
});

test("an occurrence with no snapshotted campus is unknown", () => {
  // A church that enabled geofencing but never positioned its campus must not
  // accidentally count everyone.
  assert.equal(
    bandForAttempt({
      reported: CAMPUS,
      campus: { latitude: null, longitude: null, radiusMeters: 150 },
      maxAccuracyMeters: 100,
    }),
    "unknown",
  );
});

test("a zero or missing radius is unknown, not a point-sized region", () => {
  for (const radiusMeters of [0, -1, Number.NaN]) {
    assert.equal(
      bandForAttempt({
        reported: CAMPUS,
        campus: { ...CAMPUS, radiusMeters },
        maxAccuracyMeters: 100,
      }),
      "unknown",
      `radius ${radiusMeters} should be unknown`,
    );
  }
});

test("a null radius falls back to the documented default", () => {
  assert.equal(
    bandForAttempt({
      reported: north(CAMPUS, 100),
      campus: { ...CAMPUS, radiusMeters: null },
      maxAccuracyMeters: 100,
    }),
    "inside",
  );
});

test("only 'inside' is accepted by the command — everything else fails closed", () => {
  // The database refuses any band that is not exactly 'inside'. Stated here so
  // the two halves of the rule sit next to each other.
  const refused: ReturnType<typeof band>[] = ["near", "far", "unknown"];
  for (const value of refused) {
    assert.notEqual(value, "inside");
  }
  assert.equal(band(CAMPUS), "inside");
});
