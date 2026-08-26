/**
 * Server-side distance banding for an attendance attempt.
 *
 * **Why this exists.** `P6_ATTENDANCE_ARCHITECTURE.md` states that submitted
 * coordinates are re-validated against the campus position the *server* holds.
 * That was the design, but it was not the implementation: `submitAttempt`
 * passed `distance_band: 'inside'` unconditionally, and the occurrence's
 * `campus_latitude` / `campus_longitude` / `geofence_radius_m` columns were
 * selected and then never read. The database's `outside_region` branch was
 * therefore unreachable for a geofence attempt.
 *
 * Prompt 7 is the first time a real device submits one of these, so this is
 * where the gap has to close. The band is now computed here, from the
 * occurrence's own snapshotted campus position, and a client that supplies no
 * usable coordinates gets `unknown` — which the command rejects.
 *
 * **What this is not.** It is not anti-spoofing. A device can report whatever
 * coordinates it likes, and nothing here detects that. What it does is make the
 * *server* the one doing the arithmetic, against numbers the client never
 * supplied, so a client cannot simply assert that it was inside.
 *
 * **Privacy.** The coordinates are arguments, never state. Nothing here stores,
 * logs, or returns them; the caller keeps the band and discards the position.
 */

export type DistanceBand = "inside" | "near" | "far" | "unknown";

/** Metres. Beyond the radius but within this is `near` rather than `far`. */
const NEAR_MARGIN_METERS = 250;

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a projected approximation: a campus radius is tens to
 * hundreds of metres, and the error of a flat-earth approximation at that scale
 * is irrelevant — but haversine is not measurably slower here and does not have
 * to be reasoned about near the poles or the antimeridian.
 */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isUsableCoordinate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Bands a reported position against the occurrence's own campus.
 *
 * Returns `unknown` — not `inside` — whenever the answer cannot be computed:
 * missing client coordinates, an out-of-range latitude or longitude, a campus
 * the occurrence never snapshotted, or a non-finite radius. `unknown` is
 * refused by `record_attendance`, so every one of those cases fails closed.
 *
 * The accuracy reading widens the circle rather than being ignored: a fix good
 * to ±80 m taken 60 m outside the boundary is genuinely ambiguous, and calling
 * that `far` would refuse honest attendance on a cloudy day indoors. It is
 * bounded so a client cannot claim a 10 km accuracy and be treated as inside
 * everywhere.
 */
export function bandForAttempt(input: {
  reported: { latitude?: number | null; longitude?: number | null };
  campus: {
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number | null;
  };
  accuracyMeters?: number | null;
  /** The policy's accuracy ceiling; also caps how far accuracy may widen the circle. */
  maxAccuracyMeters: number;
}): DistanceBand {
  const { reported, campus } = input;

  if (!isUsableCoordinate(reported.latitude) || !isUsableCoordinate(reported.longitude)) {
    return "unknown";
  }
  if (!isUsableCoordinate(campus.latitude) || !isUsableCoordinate(campus.longitude)) {
    return "unknown";
  }
  if (Math.abs(reported.latitude) > 90 || Math.abs(reported.longitude) > 180) {
    return "unknown";
  }
  if (Math.abs(campus.latitude) > 90 || Math.abs(campus.longitude) > 180) {
    return "unknown";
  }

  const radius = Number(campus.radiusMeters ?? 150);
  if (!Number.isFinite(radius) || radius <= 0) return "unknown";

  const distance = distanceMeters(
    { latitude: reported.latitude, longitude: reported.longitude },
    { latitude: campus.latitude, longitude: campus.longitude },
  );

  // Bounded by the policy ceiling: an implausible accuracy claim cannot buy an
  // arbitrarily large circle.
  const slack = isUsableCoordinate(input.accuracyMeters)
    ? Math.max(0, Math.min(input.accuracyMeters, input.maxAccuracyMeters))
    : 0;

  if (distance <= radius + slack) return "inside";
  if (distance <= radius + slack + NEAR_MARGIN_METERS) return "near";
  return "far";
}
