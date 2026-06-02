/** US church timezones shown first in pickers. */
export const COMMON_US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

const FRIENDLY_LABELS: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific",
  "America/Phoenix": "Arizona",
  "America/Anchorage": "Alaska",
  "Pacific/Honolulu": "Hawaii",
};

export function getAllTimezones(): string[] {
  if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
    return Intl.supportedValuesOf("timeZone").sort();
  }
  return [...COMMON_US_TIMEZONES];
}

export function formatTimezoneLabel(tz: string): string {
  const friendly = FRIENDLY_LABELS[tz];
  const place = tz.replace(/_/g, " ").split("/").pop() ?? tz;
  if (friendly) {
    return `${friendly} — ${place}`;
  }
  return tz.replace(/_/g, " ");
}

export function filterTimezones(query: string, selected?: string): string[] {
  const all = getAllTimezones();
  const q = query.trim().toLowerCase();

  if (!q) {
    const commonSet = new Set<string>(COMMON_US_TIMEZONES);
    const rest = all.filter((tz) => !commonSet.has(tz));
    const pinned = COMMON_US_TIMEZONES.filter((tz) => all.includes(tz));
    return [...pinned, ...rest.slice(0, 40)];
  }

  const matches = all.filter(
    (tz) =>
      tz.toLowerCase().includes(q) ||
      formatTimezoneLabel(tz).toLowerCase().includes(q),
  );

  if (selected && !matches.includes(selected)) {
    return [selected, ...matches].slice(0, 50);
  }

  return matches.slice(0, 50);
}
