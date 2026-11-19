"use server";

import { resolvePlaceAddress, searchPlaceSuggestions } from "@/lib/announcements/place-suggestions";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";

/** People addresses use Google Places only; they never read or write the event location library. */
async function peopleEditor() {
  const auth = await getChurchAuth();
  if (!auth?.churchId) return null;
  return await featureActionError("people") ? null : auth;
}

export async function searchPersonAddresses(query: string, sessionToken?: string) {
  try {
    if (!(await peopleEditor())) return { ok: false as const, error: "Sign in with access to People to search addresses." };
    if (typeof query !== "string" || query.trim().length < 3 || query.length > 200) {
      return { ok: true as const, suggestions: [], addressSearch: "ready" as const };
    }
    const result = await searchPlaceSuggestions(query, sessionToken);
    return { ok: true as const, suggestions: result.suggestions, addressSearch: result.status };
  } catch {
    return { ok: false as const, error: "Address suggestions couldn't load. You can still type the full address." };
  }
}

export async function resolvePersonAddress(placeId: string, sessionToken?: string) {
  try {
    if (!(await peopleEditor())) return { ok: false as const, error: "Sign in with access to People to choose an address." };
    return await resolvePlaceAddress(placeId, sessionToken);
  } catch {
    return { ok: false as const, error: "We couldn't load that address. Choose it again or type the full address." };
  }
}

export async function noChurchAddressForPeople() {
  return { ok: false as const, error: "Type this person's home address." };
}
