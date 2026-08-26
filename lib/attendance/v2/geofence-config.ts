import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { getVisitorAccount } from "@/lib/faithful/account";
import {
  hasAutomaticAttendanceConsent,
  resolveSelfCheckInMember,
} from "@/lib/attendance/v2/check-in";

/**
 * The geofence configuration a native client needs to register an OS region.
 *
 * **Why the boundary is returned.** Core Location's `CLCircularRegion` and
 * Android's `GeofencingClient` both require a centre coordinate and a radius on
 * the device — the OS does the monitoring, and it cannot monitor a region it
 * has not been told about. There is no design in which the client registers a
 * geofence without knowing where it is.
 *
 * Withholding it was never a security control in any case. A church's address
 * is on its own website, in the public discovery projection this codebase
 * already serves, and on a map. Treating it as a secret bought nothing and cost
 * the feature.
 *
 * **Where the security actually is.** Server-side, on submission:
 *
 *   - The occurrence, its window and its policy snapshot are authoritative.
 *   - Submitted coordinates are re-validated against the campus position the
 *     *server* holds, not the one it handed out.
 *   - Dwell and confirmation must be satisfied before a fact is counted.
 *   - Accuracy is banded and out-of-band readings are refused.
 *   - The People link, the relationship and the consent are all re-checked.
 *
 * A client that lies about its location is defeated by validation, not by
 * ignorance of the target. What *is* withheld is anything that would not help
 * the OS: other churches, staff data, People records, internal thresholds.
 *
 * **There is deliberately no integrity signature.** An earlier version returned
 * an HMAC `integrity` field described as detecting a tampered cached copy. It
 * did no such thing: the client has no key and so cannot verify it, the server
 * never accepts it back, and the transport is already authenticated by TLS. It
 * was a security-shaped field with no security in it — worse than nothing,
 * because a reader could reasonably assume something was being checked.
 *
 * The two values that survived do real work:
 *
 *   - `configVersion` identifies *which* configuration this is, and folds in
 *     the account's authorization version so a revocation changes it.
 *   - The **ETag**, computed over the entire response body, validates a cache.
 *
 * Neither is presented as proof of anything.
 */

/**
 * How often an authorized client must come back to have its authorization
 * re-checked. Short on purpose: a revocation should take effect within a
 * service, not at the end of a long-lived cache entry.
 *
 * This is a *period*, not a per-request TTL. See `resolveExpiry`.
 */
const REVALIDATION_PERIOD_SECONDS = 15 * 60;

/**
 * When this configuration stops being valid.
 *
 * **The rule: `expiresAt` is deterministic within an epoch-aligned time bucket
 * and the relevant attendance-window state.** It is *not* independent of `now`
 * — `now` selects which bucket applies. What matters is that it changes only at
 * predictable boundaries (a 15-minute bucket edge, or a check-in window edge),
 * so every request landing in the same bucket with the same windows produces
 * the same value.
 *
 * That matters because `expiresAt` is part of the response body, and the body
 * is what the ETag is computed over. A `now + TTL` expiry — which is what this
 * originally did — changes on *every* request, so either the ETag changes on
 * every request (revalidation never succeeds) or the expiry is excluded from it
 * (a client revalidating an *expired* configuration gets a 304 and no new
 * expiry, and is stuck there forever). Both are wrong. Quantizing removes the
 * choice.
 *
 * The value is the earliest of:
 *
 *   1. **The next revalidation boundary** — epoch-aligned, so every client of
 *      every church rolls over on the same schedule and a bucket's ETag is
 *      shared. Always strictly in the future, including exactly on a boundary.
 *   2. **The next check-in window boundary** — the instants at which the
 *      `windows` array itself would change. A window closing removes it from
 *      the response, so the configuration genuinely stops being accurate then.
 *
 * That yields a property worth stating explicitly, because it is what makes the
 * 304 safe:
 *
 * > A 304 can only be served while the client's cached `expiresAt` is still in
 * > the future.
 *
 * Proof: a client holding `X` revalidates at `t >= X`. Every candidate above is
 * either the end of a bucket containing `t` (hence `> t >= X`) or a boundary
 * `> t >= X`. So the new minimum is `> X`, the body differs, the ETag differs,
 * and the client gets a 200 with a fresh expiry. A stale 304 is unreachable
 * rather than merely unlikely.
 */
export function resolveExpiry(now: Date, windows: GeofenceWindow[]): string {
  const nowMs = now.getTime();
  const periodMs = REVALIDATION_PERIOD_SECONDS * 1000;

  // (floor(now / P) + 1) * P — strictly greater than `now` for every input,
  // including one exactly on a boundary.
  let expiryMs = (Math.floor(nowMs / periodMs) + 1) * periodMs;

  for (const window of windows) {
    for (const boundary of [window.checkinOpensAt, window.checkinClosesAt]) {
      const ms = Date.parse(boundary);
      if (Number.isFinite(ms) && ms > nowMs && ms < expiryMs) expiryMs = ms;
    }
  }

  return new Date(expiryMs).toISOString();
}

export type GeofenceRegion = {
  /** Stable across refreshes, so the OS can update rather than re-register. */
  regionId: string;
  campusName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type GeofenceWindow = {
  occurrenceId: string;
  label: string;
  startsAt: string;
  endsAt: string;
  checkinOpensAt: string;
  checkinClosesAt: string;
  timezone: string;
};

export type GeofenceConfiguration = {
  churchSlug: string;
  regions: GeofenceRegion[];
  windows: GeofenceWindow[];
  sources: { geofence: boolean; qr: boolean; manual: boolean };
  requiresConfirmation: boolean;
  minDwellSeconds: number;
  maxLocationAccuracyM: number;
  configVersion: number;
  /**
   * Deterministic within an epoch-aligned bucket and the current window state:
   * it moves only at predictable 15-minute or check-in-window boundaries, not
   * on every request. See `resolveExpiry`.
   */
  expiresAt: string;
};

/**
 * Why a configuration was refused.
 *
 * Distinct cases because the client shows different things: missing consent is
 * a prompt, a revoked link is a message to contact the church, and a disabled
 * source is neither.
 */
export type GeofenceConfigRefusal =
  | "not_enrolled"
  | "no_people_link"
  | "consent_required"
  | "geofence_disabled"
  | "no_campus_configured";

export type GeofenceConfigResult =
  | { ok: true; configuration: GeofenceConfiguration }
  | { ok: false; reason: GeofenceConfigRefusal };

/**
 * Builds the configuration for one account and one church.
 *
 * Five independent gates, every one re-derived rather than cached:
 *
 *   1. The account exists and is active.
 *   2. It holds a usable relationship with this church.
 *   3. It holds an **active verified People link** for this church.
 *   4. Automatic-attendance consent is currently `granted`.
 *   5. The church has geofence attendance enabled and at least one active,
 *      positioned campus.
 *
 * Failing any of them returns a typed refusal, and the client removes whatever
 * regions it had registered.
 */
export async function buildGeofenceConfiguration(
  userId: string,
  churchSlug: string,
  now: Date = new Date(),
): Promise<GeofenceConfigResult> {
  const admin = createAdminClient();

  const { data: church } = await admin
    .from("churches")
    .select("id, slug")
    .eq("slug", churchSlug)
    .maybeSingle();

  if (!church) return { ok: false, reason: "not_enrolled" };
  const churchId = church.id as string;

  const account = await getVisitorAccount(userId);
  if (!account || account.status !== "active") {
    return { ok: false, reason: "not_enrolled" };
  }

  // Gates 2 and 3 together: the relationship must be usable *and* a verified
  // People link must exist. A revoked relationship or a removed link both land
  // here, and the client tears its regions down.
  const link = await resolveSelfCheckInMember(account.id, churchId, admin);
  if (!link.ok) {
    return {
      ok: false,
      reason: link.reason === "no_people_link" ? "no_people_link" : "not_enrolled",
    };
  }

  // Gate 4. `unset` is not consent, and a revocation takes effect here rather
  // than only at submission.
  if (!(await hasAutomaticAttendanceConsent(account.id, admin))) {
    return { ok: false, reason: "consent_required" };
  }

  // Gate 5. Only active, public, positioned campuses can be monitored.
  const { data: campuses } = await admin
    .from("church_campuses")
    .select("id, name, latitude, longitude, geofence_radius_m, is_active, is_public")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    // Both platforms cap how many regions an app may register; a church with
    // more campuses than this needs a proximity strategy the clients own.
    .limit(20);

  const positioned = ((campuses ?? []) as Record<string, unknown>[]).filter(
    (campus) => campus.is_active && campus.is_public,
  );

  if (positioned.length === 0) {
    return { ok: false, reason: "no_campus_configured" };
  }

  // The policy that will actually judge an attempt.
  const { data: policy } = await admin
    .from("attendance_policies")
    .select(
      "geofence_enabled, qr_enabled, manual_enabled, requires_confirmation, min_dwell_seconds, max_location_accuracy_m, policy_version",
    )
    .eq("church_id", churchId)
    .is("campus_id", null)
    .is("service_time_id", null)
    .maybeSingle();

  if (!policy?.geofence_enabled) {
    return { ok: false, reason: "geofence_disabled" };
  }

  // Upcoming windows only, and bounded. A client does not need the whole year.
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 7);

  const { data: occurrences } = await admin
    .from("service_occurrences")
    .select(
      "id, label, starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc, timezone",
    )
    .eq("church_id", churchId)
    .in("status", ["scheduled", "active"])
    .gte("checkin_closes_at_utc", now.toISOString())
    .lte("starts_at_utc", horizon.toISOString())
    .order("starts_at_utc", { ascending: true })
    .limit(50);

  const regions: GeofenceRegion[] = positioned.map((campus) => ({
    // Stable across refreshes so the OS updates rather than re-registers.
    regionId: `faithful.campus.${campus.id as string}`,
    campusName: campus.name as string,
    latitude: Number(campus.latitude),
    longitude: Number(campus.longitude),
    radiusMeters: Number(campus.geofence_radius_m ?? 150),
  }));

  const windows: GeofenceWindow[] = ((occurrences ?? []) as Record<string, unknown>[]).map(
    (occurrence) => ({
      occurrenceId: occurrence.id as string,
      label: occurrence.label as string,
      startsAt: occurrence.starts_at_utc as string,
      endsAt: occurrence.ends_at_utc as string,
      checkinOpensAt: occurrence.checkin_opens_at_utc as string,
      checkinClosesAt: occurrence.checkin_closes_at_utc as string,
      timezone: occurrence.timezone as string,
    }),
  );

  const base = {
    churchSlug,
    regions,
    windows,
    sources: {
      geofence: Boolean(policy.geofence_enabled),
      qr: Boolean(policy.qr_enabled),
      manual: Boolean(policy.manual_enabled),
    },
    requiresConfirmation: Boolean(policy.requires_confirmation ?? true),
    minDwellSeconds: Number(policy.min_dwell_seconds ?? 120),
    maxLocationAccuracyM: Number(policy.max_location_accuracy_m ?? 100),
    // Folds in the account's authorization version, so blocking, leaving, link
    // revocation or consent withdrawal all change the version a client holds.
    configVersion:
      Number(policy.policy_version ?? 1) * 1000 + account.authorizationVersion,
    // Derived from the windows just built, so it moves only when something a
    // client would act on moves.
    expiresAt: resolveExpiry(now, windows),
  };

  return { ok: true, configuration: base };
}

/**
 * A refusal the client can act on without guessing.
 *
 * Deliberately says nothing about *why* a church has geofencing off or whether
 * a campus exists — that is configuration, not the caller's business.
 */
export function refusalMessage(reason: GeofenceConfigRefusal): string {
  switch (reason) {
    case "no_people_link":
      return "Your church needs to confirm who you are first.";
    case "consent_required":
      return "Turn on automatic check-in to use this.";
    case "geofence_disabled":
    case "no_campus_configured":
      return "This church hasn't set up automatic check-in.";
    default:
      return "This church is not available to you right now.";
  }
}
