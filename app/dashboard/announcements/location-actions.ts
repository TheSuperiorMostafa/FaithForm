"use server";

import { getLocationSuggestions, saveLocation } from "@/lib/announcements/location-suggestions";
import { searchPlaceSuggestions } from "@/lib/announcements/place-suggestions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { formatAddressLine } from "@/lib/utils/address";

export type EventLocationSuggestion = { label: string; value: string; source: "saved" | "google" };

async function locationAuth() {
  const auth = await getChurchAuth();
  if (!auth?.churchId) return null;
  return await featureActionError("announcements") ? null : auth;
}

export async function searchLocations(query: string): Promise<
  | { ok: true; suggestions: EventLocationSuggestion[]; addressSearch: "ready" | "unconfigured" | "unavailable"; notice?: string }
  | { ok: false; error: string }
> {
  try {
    const auth = await locationAuth();
    if (!auth) return { ok: false, error: "Sign in with access to Announcements to search addresses." };
    if (typeof query !== "string" || query.trim().length < 3 || query.length > 200) return { ok: true, suggestions: [], addressSearch: "ready" };
    const [savedResult, placesResult] = await Promise.allSettled([
      getLocationSuggestions(auth.churchId, query.trim(), createAdminClient()),
      searchPlaceSuggestions(query),
    ]);
    const saved = savedResult.status === "fulfilled" ? savedResult.value : [];
    const places = placesResult.status === "fulfilled" ? placesResult.value : { status: "unavailable" as const, suggestions: [] };
    const suggestions: EventLocationSuggestion[] = saved.map(s => ({ label: s.name, value: s.fullAddress, source: "saved" }));
    const seen = new Set(suggestions.map(s => s.value.toLowerCase()));
    for (const suggestion of places.suggestions) {
      if (!seen.has(suggestion.value.toLowerCase())) { suggestions.push(suggestion); seen.add(suggestion.value.toLowerCase()); }
    }
    return { ok: true, suggestions, addressSearch: places.status, ...(savedResult.status === "rejected" ? { notice: "Saved locations couldn't load. You can still search or type the full address." } : {}) };
  } catch {
    return { ok: false, error: "Address suggestions couldn't load. You can still type the full address." };
  }
}

export async function getChurchEventLocation(): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  try {
    const auth = await locationAuth();
    if (!auth) return { ok: false, error: "Sign in with access to Announcements to use the church address." };
    const { data, error } = await createAdminClient().from("churches").select("name, address, city, state, zip").eq("id", auth.churchId).maybeSingle();
    if (error || !data) return { ok: false, error: "We couldn't load the church address. Type it here or try again." };
    const address = formatAddressLine(data);
    if (!address) return { ok: false, error: "Add your church address in Settings first, or type a location here." };
    return { ok: true, value: [data.name?.trim(), address].filter(Boolean).join(", ") };
  } catch {
    return { ok: false, error: "We couldn't load the church address. Type it here or try again." };
  }
}

export async function trackLocationUsage(location: string): Promise<{ ok: boolean }> {
  try {
    const auth = await locationAuth();
    if (!auth || typeof location !== "string" || !location.trim() || location.length > 500) return { ok: false };
    const result = await saveLocation(auth.churchId, location, auth.userId, createAdminClient());
    return { ok: result.ok };
  } catch {
    return { ok: false };
  }
}
