import "server-only";

export type PlaceSuggestion = { label: string; value: string; source: "google"; placeId?: string };
export type PlaceSearchResult = { status: "ready" | "unconfigured" | "unavailable"; suggestions: PlaceSuggestion[] };

function token(value?: string): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,36}$/.test(value) ? value : undefined;
}

/** Server-only: the key never enters a URL, client response or log. */
export async function searchPlaceSuggestions(input: string, sessionToken?: string): Promise<PlaceSearchResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return { status: "unconfigured", suggestions: [] };
  const query = input.trim();
  if (query.length < 3 || query.length > 200) return { status: "ready", suggestions: [] };
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(3500),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text" },
      body: JSON.stringify({ input: query, ...(token(sessionToken) ? { sessionToken: token(sessionToken) } : {}) }),
    });
    if (!response.ok) return { status: "unavailable", suggestions: [] };
    const body = await response.json() as { suggestions?: { placePrediction?: { placeId?: unknown; text?: { text?: unknown } } }[] };
    if (!Array.isArray(body.suggestions) && body.suggestions !== undefined) return { status: "unavailable", suggestions: [] };
    const suggestions: PlaceSuggestion[] = [];
    for (const item of body.suggestions ?? []) {
      const text = item?.placePrediction?.text?.text;
      if (typeof text !== "string" || !text.trim() || text.length > 500) continue;
      const placeId = item?.placePrediction?.placeId;
      if (!suggestions.some(row => row.value === text)) suggestions.push({ label: text, value: text, source: "google", ...(typeof placeId === "string" ? { placeId } : {}) });
      if (suggestions.length === 5) break;
    }
    return { status: "ready", suggestions };
  } catch {
    return { status: "unavailable", suggestions: [] };
  }
}

/** Resolve a selected result to its full street address, including postal code. */
export async function resolvePlaceAddress(placeId: string, sessionToken?: string): Promise<
  { ok: true; value: string } | { ok: false; error: string }
> {
  const fallback = { ok: false as const, error: "We couldn't load that address. Choose it again or add the street address yourself." };
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key || typeof placeId !== "string" || !/^[a-zA-Z0-9_-]{1,512}$/.test(placeId)) return fallback;
  try {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    const session = token(sessionToken);
    if (session) url.searchParams.set("sessionToken", session);
    const response = await fetch(url, {
      cache: "no-store", signal: AbortSignal.timeout(3500),
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "displayName,formattedAddress" },
    });
    if (!response.ok) return fallback;
    const body = await response.json() as { formattedAddress?: unknown; displayName?: { text?: unknown } };
    const address = typeof body.formattedAddress === "string" ? body.formattedAddress.trim() : "";
    const name = typeof body.displayName?.text === "string" ? body.displayName.text.trim() : "";
    if (!address || address.length > 500) return fallback;
    const value = name && !address.toLowerCase().startsWith(name.toLowerCase()) ? `${name}, ${address}` : address;
    return value.length <= 500 ? { ok: true, value } : fallback;
  } catch {
    return fallback;
  }
}
