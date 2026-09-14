/**
 * The limits check-in setup shares between the server and the browser.
 *
 * Kept in a module with no imports at all, so a client component can read them
 * without pulling `lib/attendance/v2/setup.ts` (and through it the service-role
 * client and `next/headers`) into the browser bundle.
 */

/** Metres. The database holds the same bound (migration 0074). */
export const GEOFENCE_RADIUS_BOUNDS = { min: 50, max: 500, default: 150 } as const;

/**
 * Below this many, a church is not told how many people turned automatic
 * check-in on. A church knows who is linked, so a count of one or two would
 * tell it who opted in.
 */
export const CONSENT_COUNT_FLOOR = 5;
