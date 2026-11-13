import "server-only";

export type PlaceSuggestion = { label: string; value: string; source: "google" };
export type PlaceSearchResult = { status: "ready" | "unconfigured" | "unavailable"; suggestions: PlaceSuggestion[] };

/** Server-only: the key never enters a URL, client response or log. */
export async function searchPlaceSuggestions(input: string): Promise<PlaceSearchResult> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { status: "unconfigured", suggestions: [] };
  const query = input.trim();
  if (query.length < 3 || query.length > 200) return { status: "ready", suggestions: [] };
  try {
    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(3500),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "suggestions.placePrediction.text.text" },
      body: JSON.stringify({ input: query }),
    });
    if (!response.ok) return { status: "unavailable", suggestions: [] };
    const body = await response.json() as { suggestions?: { placePrediction?: { text?: { text?: unknown } } }[] };
    if (!Array.isArray(body.suggestions) && body.suggestions !== undefined) return { status: "unavailable", suggestions: [] };
    const suggestions: PlaceSuggestion[] = [];
    for (const item of body.suggestions ?? []) {
      const text = item?.placePrediction?.text?.text;
      if (typeof text !== "string" || !text.trim() || text.length > 500) continue;
      if (!suggestions.some(row => row.value === text)) suggestions.push({ label: text, value: text, source: "google" });
      if (suggestions.length === 5) break;
    }
    return { status: "ready", suggestions };
  } catch {
    return { status: "unavailable", suggestions: [] };
  }
}
