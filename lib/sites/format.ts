import { DAY_OF_WEEK_LABELS } from "@/types/church-profile";

/** Postgres `time` comes back as "09:45:00"; the design wants "9:45 AM". */
export function formatServiceTime(value: string | null | undefined): string | null {
  if (!value) return null;

  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;

  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatDayOfWeek(day: number): string {
  return DAY_OF_WEEK_LABELS[day] ?? "";
}

/** "Sun · 9:45 AM" — the compact form used on program cards. */
export function formatDayAndTime(
  day: number,
  time: string | null | undefined,
): string {
  const label = formatDayOfWeek(day).slice(0, 3);
  const clock = formatServiceTime(time);
  if (!label) return clock ?? "";
  return clock ? `${label} · ${clock}` : label;
}

/**
 * Dates arrive as ISO strings or bare `YYYY-MM-DD`. Parsing the bare form with
 * `new Date()` treats it as UTC and can render the previous day in western
 * timezones, so it is split by hand instead.
 */
export function formatLongDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = bare
    ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
    : new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Joins the parts of a postal address that are actually present. */
export function formatCityLine(
  city: string | null,
  state: string | null,
  zip: string | null,
): string | null {
  const locality = [city, state].filter(Boolean).join(", ");
  const line = [locality, zip].filter(Boolean).join(" ");
  return line || null;
}

/**
 * Google's embed endpoint takes a plain query, so a full address is enough and
 * no API key is involved. Falls back to whatever `google_maps_url` holds if the
 * church pasted a share link instead.
 */
export function buildMapEmbedUrl(query: string | null): string | null {
  if (!query) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=14&output=embed`;
}

export function buildMapDirectionsUrl(query: string | null): string | null {
  if (!query) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}`;
}
