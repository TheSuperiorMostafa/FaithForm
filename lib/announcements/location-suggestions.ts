/**
 * Event location autocomplete using saved church locations.
 * Provides intelligent suggestions without requiring Google Places API.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface LocationSuggestion {
  id: string;
  name: string;
  fullAddress: string;
  useCount: number;
}

/**
 * Get location suggestions for autocomplete.
 * Includes: church address, saved locations, recently used locations.
 */
export async function getLocationSuggestions(
  churchId: string,
  query: string,
  db: SupabaseClient
): Promise<LocationSuggestion[]> {
  const suggestions: LocationSuggestion[] = [];
  
  // Get church's own address
  const { data: church, error: churchError } = await db
    .from("churches")
    .select("name, address, city, state, zip")
    .eq("id", churchId)
    .maybeSingle();
  if (churchError) throw churchError;
  
  if (church) {
    const churchAddress = formatChurchAddress(church);
    if (churchAddress && matchesQuery(churchAddress, query)) {
      suggestions.push({
        id: "church",
        name: church.name || "Church",
        fullAddress: churchAddress,
        useCount: 9999, // Always show church first
      });
    }
  }
  
  // Get saved locations (filtered by query if provided)
  const searchQuery = query.trim().toLowerCase();
  const { data: saved, error: savedError } = await db
    .from("saved_event_locations")
    .select("id, name, full_address, use_count")
    .eq("church_id", churchId)
    .order("use_count", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (savedError) throw savedError;
  
  if (saved) {
    for (const location of saved) {
      if (!searchQuery || matchesQuery(`${location.name} ${location.full_address}`, searchQuery)) {
        suggestions.push({
          id: location.id as string,
          name: location.name,
          fullAddress: location.full_address,
          useCount: location.use_count,
        });
      }
    }
  }
  
  // Sort by relevance: church first, then by use count
  return suggestions.sort((a, b) => {
    if (a.id === "church") return -1;
    if (b.id === "church") return 1;
    return b.useCount - a.useCount;
  }).slice(0, 10); // Limit to top 10
}

function formatChurchAddress(church: {
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}): string | null {
  const parts = [church.address, church.city, church.state, church.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function matchesQuery(text: string, query: string): boolean {
  if (!query) return true;
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  return lower.includes(queryLower);
}

/**
 * Save a location to the church's library.
 * Idempotent: returns existing ID if location already saved.
 */
export async function saveLocation(
  churchId: string,
  location: string,
  userId: string,
  db: SupabaseClient
): Promise<{ ok: boolean; locationId?: string; error?: string }> {
  if (!location || location.trim().length < 5) {
    return { ok: false, error: "Location too short" };
  }
  
  const trimmed = location.trim();
  
  // Check if already exists
  const { data: existing } = await db
    .from("saved_event_locations")
    .select("id")
    .eq("church_id", churchId)
    .ilike("full_address", trimmed)
    .maybeSingle();
  
  if (existing) {
    return { ok: true, locationId: existing.id as string };
  }
  
  // Create new saved location
  const { data, error } = await db
    .from("saved_event_locations")
    .insert({
      church_id: churchId,
      name: extractLocationName(trimmed),
      full_address: trimmed,
      use_count: 1,
      last_used_at: new Date().toISOString(),
      created_by: userId,
    })
    .select("id")
    .single();
  
  if (error || !data) {
    return { ok: false, error: error?.message || "Failed to save location" };
  }
  
  return { ok: true, locationId: data.id as string };
}

/**
 * Extract a short name from a full address.
 * e.g., "Community Center, 123 Main St, City, ST" -> "Community Center"
 */
function extractLocationName(fullAddress: string): string {
  const parts = fullAddress.split(/[,·]/);
  const first = parts[0]?.trim();
  
  // If first part is very long or looks like a street address, use full address
  if (!first || first.length > 80 || /^\d+\s/.test(first)) {
    return fullAddress.substring(0, 80);
  }
  
  return first;
}

/**
 * Record that a location was used in an event.
 * Automatically adds frequently used locations to saved library.
 */
export async function recordLocationUse(
  churchId: string,
  location: string,
  db: SupabaseClient
): Promise<void> {
  if (!location || location.trim().length < 5) return;
  
  try {
    await db.rpc("record_event_location_use", {
      p_church_id: churchId,
      p_location: location.trim(),
    });
  } catch (error) {
    // Non-critical: just log
    console.warn("[location-suggestions] Failed to record use:", error);
  }
}
