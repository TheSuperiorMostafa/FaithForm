import { z } from "zod";

/**
 * Address to coordinates, for a church admin placing a campus.
 *
 * OpenStreetMap's Nominatim, because it needs no key and no account, and a
 * church looks its address up a handful of times in its life. Its usage policy
 * asks for an identifying User-Agent, no more than one request a second, and
 * attribution; the dashboard action that calls this is limited per church, and
 * the map beside the result credits OpenStreetMap.
 *
 * What is sent is the address the admin typed, which is a church's public
 * address. Nothing about a person who attends ever reaches this function, and
 * the phones never call it: they are told the campus position the church saved.
 *
 * `GEOCODER_BASE_URL` points it at a self-hosted Nominatim, and
 * `GEOCODER_USER_AGENT` replaces the default identification. Both optional.
 */

export type GeocodeMatch = {
  label: string;
  latitude: number;
  longitude: number;
};

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_USER_AGENT = "FaithForm/1.0 (+https://faithform.io; support@faithform.io)";

const nominatimResultSchema = z.array(
  z.object({
    lat: z.string(),
    lon: z.string(),
    display_name: z.string(),
  }),
);

export const geocodeQuerySchema = z
  .string()
  .trim()
  .min(3, "Type the church's street address.")
  .max(300, "That address is too long.");

/** Parses a Nominatim response into matches, dropping anything unusable. */
export function parseGeocodeResponse(body: unknown): GeocodeMatch[] {
  const parsed = nominatimResultSchema.safeParse(body);
  if (!parsed.success) return [];

  return parsed.data
    .map((row) => ({
      label: row.display_name.slice(0, 300),
      latitude: Number(row.lat),
      longitude: Number(row.lon),
    }))
    .filter(
      (match) =>
        Number.isFinite(match.latitude) &&
        Number.isFinite(match.longitude) &&
        Math.abs(match.latitude) <= 90 &&
        Math.abs(match.longitude) <= 180,
    )
    .slice(0, 5);
}

export async function geocodeAddress(
  query: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<GeocodeMatch[] | null> {
  const parsed = geocodeQuerySchema.safeParse(query);
  if (!parsed.success) return [];

  const base = (process.env.GEOCODER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(`${base}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("q", parsed.data);

  const fetchImpl = options?.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": process.env.GEOCODER_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "en",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(options?.timeoutMs ?? 6000),
    });
    if (!response.ok) return null;
    return parseGeocodeResponse(await response.json());
  } catch {
    // A timeout or a provider outage. The caller says the lookup is
    // unavailable and the admin can still drop a pin or type coordinates.
    return null;
  }
}
