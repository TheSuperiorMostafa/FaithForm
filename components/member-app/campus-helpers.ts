/**
 * Plain defaults for the campus form, so a pastor types a name and an address
 * and nothing else. Pure, so they can be tested without rendering anything.
 */

/** The web-address part for a campus, made from its name: "East Campus" → "east-campus". */
export function campusSlugFrom(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Time zones a US church is likely to be in, named the way people say them. */
export const COMMON_TIME_ZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern time" },
  { value: "America/Chicago", label: "Central time" },
  { value: "America/Denver", label: "Mountain time" },
  { value: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { value: "America/Los_Angeles", label: "Pacific time" },
  { value: "America/Anchorage", label: "Alaska time" },
  { value: "Pacific/Honolulu", label: "Hawaii time" },
  { value: "America/Puerto_Rico", label: "Atlantic time (Puerto Rico)" },
];

/** A readable name for a stored time zone, falling back to the raw value. */
export function timeZoneLabel(value: string): string {
  return COMMON_TIME_ZONES.find((zone) => zone.value === value)?.label ?? value.replace(/_/g, " ");
}

/**
 * The best starting time zone for a new campus: the church's existing campuses
 * first (a second campus is nearly always in the same zone), then this
 * computer's own, then Eastern.
 */
export function defaultCampusTimeZone(
  existing: { timezone: string; isPrimary?: boolean }[],
  browserZone?: string | null,
): string {
  const primary = existing.find((campus) => campus.isPrimary) ?? existing[0];
  if (primary?.timezone) return primary.timezone;
  if (browserZone && /^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(browserZone)) return browserZone;
  return "America/New_York";
}
