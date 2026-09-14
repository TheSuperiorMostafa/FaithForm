import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
  coordinateAtViewportPoint,
  metersPerPixel,
  project,
  tilesForViewport,
  unproject,
  zoomToFit,
} from "@/lib/maps/web-mercator";
import { distanceMeters } from "@/lib/attendance/v2/distance";
import { geocodeAddress, parseGeocodeResponse } from "@/lib/attendance/v2/geocode";
import {
  CONSENT_COUNT_FLOOR,
  attendanceSetupPolicySchema,
  campusCheckinLocationSchema,
  publishableOptInCount,
  serviceScheduleSchema,
} from "@/lib/attendance/v2/setup";
import { campusIdFromRegionId } from "@/lib/attendance/v2/occurrences";
import { rotationSlice } from "@/lib/attendance/v2/jobs";
import { contractOutcome } from "@/lib/mobile/v1/attendance-service";
import { attendanceOutcomeSchema } from "@/lib/mobile/v1/contract";
import {
  displayMessageFor,
  mobileCodeForAttendanceReason,
} from "@/lib/attendance/v2/results";

const CAMPUS = { latitude: 38.2527, longitude: -85.7585 };

// ---------------------------------------------------------------------------
// The campus map: what the admin sees is where the phones watch
// ---------------------------------------------------------------------------

test("projecting and unprojecting a coordinate returns it", () => {
  for (const zoom of [3, 12, 17, 19]) {
    for (const point of [CAMPUS, { latitude: -33.8688, longitude: 151.2093 }, { latitude: 0, longitude: 0 }]) {
      const pixels = project(point.latitude, point.longitude, zoom);
      const back = unproject(pixels.x, pixels.y, zoom);
      assert.ok(Math.abs(back.latitude - point.latitude) < 1e-9, `${zoom} latitude`);
      assert.ok(Math.abs(back.longitude - point.longitude) < 1e-9, `${zoom} longitude`);
    }
  }
});

test("the metres-per-pixel scale matches the standard Web Mercator figure", () => {
  // 156,543.03 m per pixel at the equator at zoom 0 is the published constant.
  assert.ok(Math.abs(metersPerPixel(0, 0) - 156_543.03) < 0.01);
  // Halves with each zoom level, and shrinks with the cosine of latitude.
  assert.ok(Math.abs(metersPerPixel(0, 1) - 156_543.03 / 2) < 0.01);
  assert.ok(Math.abs(metersPerPixel(60, 0) - 156_543.03 / 2) < 0.05);
});

test("the circle drawn on the map is the radius the server checks against", () => {
  // A point 150 m east of the pin, placed on the map by pixels, is 150 m away
  // by the same haversine the server bands attempts with.
  const zoom = 17;
  const width = 600;
  const height = 280;
  const radiusPixels = 150 / metersPerPixel(CAMPUS.latitude, zoom);
  const edge = coordinateAtViewportPoint({
    center: CAMPUS,
    zoom,
    width,
    height,
    pointX: width / 2 + radiusPixels,
    pointY: height / 2,
  });
  const measured = distanceMeters(CAMPUS, edge);
  assert.ok(Math.abs(measured - 150) < 1, `edge of the circle is ${measured} m away`);
});

test("clicking the centre of the map picks the centre", () => {
  const picked = coordinateAtViewportPoint({
    center: CAMPUS,
    zoom: 16,
    width: 500,
    height: 280,
    pointX: 250,
    pointY: 140,
  });
  assert.ok(Math.abs(picked.latitude - CAMPUS.latitude) < 1e-9);
  assert.ok(Math.abs(picked.longitude - CAMPUS.longitude) < 1e-9);
});

test("the tiles cover the whole map and nothing outside the world", () => {
  const width = 620;
  const height = 280;
  const tiles = tilesForViewport({ ...CAMPUS, zoom: 17, width, height });
  assert.ok(tiles.length >= 4);

  // Every pixel of the viewport lies on some tile.
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [width / 2, height / 2]]) {
    assert.ok(
      tiles.some((t) => x >= t.left && x < t.left + TILE_SIZE && y >= t.top && y < t.top + TILE_SIZE),
      `pixel ${x},${y} is uncovered`,
    );
  }

  for (const tile of tiles) {
    assert.match(tile.url, /^https:\/\/tile\.openstreetmap\.org\/17\/\d+\/\d+\.png$/);
  }

  // Near a pole the rows past the edge of the world are skipped, not requested.
  const polar = tilesForViewport({ latitude: 85, longitude: 0, zoom: 3, width, height });
  for (const tile of polar) {
    const row = Number(tile.url.split("/").at(-1)!.replace(".png", ""));
    assert.ok(row >= 0 && row < 8);
  }
});

test("the map zooms so the whole check-in circle is visible", () => {
  for (const radius of [50, 150, 500]) {
    const zoom = zoomToFit(CAMPUS.latitude, radius, 280);
    assert.ok(zoom >= MIN_ZOOM && zoom <= MAX_ZOOM);
    const diameterPixels = (2 * radius) / metersPerPixel(CAMPUS.latitude, zoom);
    assert.ok(diameterPixels <= 280, `a ${radius} m circle overflows at zoom ${zoom}`);
    // And not a speck: at least a fifth of the map.
    assert.ok(diameterPixels >= 56, `a ${radius} m circle is too small at zoom ${zoom}`);
  }
  assert.equal(zoomToFit(CAMPUS.latitude, 0, 280), 16);
});

// ---------------------------------------------------------------------------
// Address lookup
// ---------------------------------------------------------------------------

test("a geocoder response is reduced to usable matches", () => {
  const matches = parseGeocodeResponse([
    { lat: "38.2527", lon: "-85.7585", display_name: "Main Street Church, Louisville" },
    { lat: "not a number", lon: "1", display_name: "Broken" },
    { lat: "95", lon: "1", display_name: "Off the planet" },
  ]);
  assert.deepEqual(matches, [
    { label: "Main Street Church, Louisville", latitude: 38.2527, longitude: -85.7585 },
  ]);
  assert.deepEqual(parseGeocodeResponse({ error: "nope" }), []);
});

test("the geocoder identifies itself, sends only the address, and fails soft", async () => {
  let requested: URL | null = null;
  let userAgent: string | null = null;

  const ok = await geocodeAddress("100 Main St, Louisville KY", {
    fetchImpl: (async (url: URL, init?: RequestInit) => {
      requested = url;
      userAgent = new Headers(init?.headers).get("user-agent");
      return new Response(JSON.stringify([{ lat: "38.25", lon: "-85.75", display_name: "100 Main St" }]));
    }) as unknown as typeof fetch,
  });

  assert.equal(ok?.length, 1);
  assert.ok(requested);
  const url = requested as URL;
  assert.equal(url.searchParams.get("q"), "100 Main St, Louisville KY");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["format", "limit", "q"]);
  assert.match(String(userAgent), /FaithForm/);

  const down = await geocodeAddress("100 Main St", {
    fetchImpl: (async () => new Response("busy", { status: 503 })) as unknown as typeof fetch,
  });
  assert.equal(down, null, "an outage is reported as unavailable, not as no match");

  const thrown = await geocodeAddress("100 Main St", {
    fetchImpl: (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch,
  });
  assert.equal(thrown, null);

  let called = false;
  const tooShort = await geocodeAddress("  a ", {
    fetchImpl: (async () => {
      called = true;
      return new Response("[]");
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(tooShort, []);
  assert.equal(called, false, "an empty query never leaves the server");
});

// ---------------------------------------------------------------------------
// What an admin may set
// ---------------------------------------------------------------------------

const POLICY = {
  geofenceEnabled: true,
  qrEnabled: false,
  kioskEnabled: false,
  checkinOpensMinutesBefore: 30,
  checkinClosesMinutesAfter: 30,
  requiresConfirmation: true,
  minDwellSeconds: 120,
  maxLocationAccuracyM: 100,
};

test("the check-in window and arrival rules stay within bounds", () => {
  assert.equal(attendanceSetupPolicySchema.safeParse(POLICY).success, true);

  for (const [patch, why] of [
    [{ checkinOpensMinutesBefore: -1 }, "negative window"],
    [{ checkinOpensMinutesBefore: 241 }, "window over four hours"],
    [{ checkinClosesMinutesAfter: 241 }, "close over four hours"],
    [{ checkinOpensMinutesBefore: 0, checkinClosesMinutesAfter: 0 }, "an empty window"],
    [{ minDwellSeconds: 10 }, "a dwell too short to mean anything"],
    [{ minDwellSeconds: 3600 }, "a dwell longer than the menu offers"],
    [{ maxLocationAccuracyM: 5 }, "an accuracy no phone indoors meets"],
    [{ maxLocationAccuracyM: 1000 }, "an accuracy that accepts anything"],
  ] as const) {
    assert.equal(
      attendanceSetupPolicySchema.safeParse({ ...POLICY, ...patch }).success,
      false,
      why,
    );
  }

  // No confirmation means no dwell to satisfy, so zero is allowed then.
  assert.equal(
    attendanceSetupPolicySchema.safeParse({ ...POLICY, requiresConfirmation: false, minDwellSeconds: 0 }).success,
    true,
  );
});

test("a campus location needs a real point and a radius of 50 to 500 metres", () => {
  const good = { latitude: 38.2527, longitude: -85.7585, radiusMeters: 150 };
  assert.equal(campusCheckinLocationSchema.safeParse(good).success, true);
  for (const bad of [
    { ...good, latitude: 0, longitude: 0 },
    { ...good, latitude: 91 },
    { ...good, longitude: -181 },
    { ...good, radiusMeters: 49 },
    { ...good, radiusMeters: 501 },
    { ...good, radiusMeters: 150.5 },
  ]) {
    assert.equal(campusCheckinLocationSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("weekly service times are validated before they reach the schedule", () => {
  const row = { label: "Worship", dayOfWeek: 0, startTime: "10:30", endTime: "", campusId: null };
  assert.equal(serviceScheduleSchema.safeParse([row]).success, true);
  assert.equal(serviceScheduleSchema.safeParse([{ ...row, startTime: "25:00" }]).success, false);
  assert.equal(serviceScheduleSchema.safeParse([{ ...row, startTime: "10:30:00" }]).success, false);
  assert.equal(serviceScheduleSchema.safeParse([{ ...row, dayOfWeek: 7 }]).success, false);
  assert.equal(serviceScheduleSchema.safeParse([{ ...row, label: "  " }]).success, false);
  assert.equal(serviceScheduleSchema.safeParse([{ ...row, campusId: "not-a-uuid" }]).success, false);
  assert.equal(serviceScheduleSchema.safeParse(Array.from({ length: 21 }, () => row)).success, false);
});

test("a small opt-in count is withheld so it cannot name a person", () => {
  assert.equal(CONSENT_COUNT_FLOOR, 5);
  for (const count of [0, 1, 4]) assert.equal(publishableOptInCount(count), null);
  for (const count of [5, 6, 120]) assert.equal(publishableOptInCount(count), count);
});

// ---------------------------------------------------------------------------
// The mobile API's edges
// ---------------------------------------------------------------------------

test("only a region id this server issued names a campus", () => {
  const id = "3f2b8c9a-1d4e-4f6a-9b7c-2e5d8a1f0c3b";
  assert.equal(campusIdFromRegionId(`faithform.campus.${id}`), id);
  assert.equal(campusIdFromRegionId(`faithform.campus.${id.toUpperCase()}`), id);
  for (const other of [
    null,
    undefined,
    "",
    id,
    `faithform.campus.${id}.extra`,
    `other.campus.${id}`,
    "faithform.campus.not-a-uuid",
    "faithform.campus.'; drop table churches; --",
  ]) {
    assert.equal(campusIdFromRegionId(other), null, String(other));
  }
});

test("a replayed expired attempt is reported as a refusal the contract can carry", () => {
  // `record_attendance` replays the stored status for a repeated key, and an
  // attempt the cleanup job or a consent withdrawal closed is `expired`, which
  // the generated clients cannot decode.
  assert.equal(contractOutcome("expired"), "rejected");
  assert.equal(contractOutcome("something new"), "rejected");
  for (const outcome of attendanceOutcomeSchema.options) {
    assert.equal(contractOutcome(outcome), outcome);
  }
});

test("a throttled automatic attempt reads as waiting, and maps to rate_limited", () => {
  assert.equal(mobileCodeForAttendanceReason("attempt_throttled"), "rate_limited");
  assert.match(displayMessageFor("attempt_throttled"), /few minutes/);
});

test("the generation job reaches every church, one slice per run", () => {
  const total = 83;
  const batch = 25;
  const period = 10 * 60 * 1000;
  const seen = new Map<number, number>();

  for (let run = 0; run < Math.ceil(total / batch); run++) {
    const slice = rotationSlice(total, batch, new Date(run * period), period);
    assert.ok(slice.to - slice.from + 1 <= batch);
    for (let index = slice.from; index <= slice.to; index++) {
      seen.set(index, (seen.get(index) ?? 0) + 1);
    }
  }

  assert.equal(seen.size, total, "a church was never processed");
  assert.ok([...seen.values()].every((times) => times === 1), "a church was processed twice in one rotation");

  // The same ten minutes always choose the same slice.
  assert.deepEqual(
    rotationSlice(total, batch, new Date(3 * period + 1000), period),
    rotationSlice(total, batch, new Date(3 * period + 500_000), period),
  );
  assert.deepEqual(rotationSlice(0, batch, new Date()), { from: 0, to: -1 });
});
