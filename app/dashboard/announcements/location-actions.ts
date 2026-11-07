"use server";

import { getLocationSuggestions, saveLocation } from "@/lib/announcements/location-suggestions";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireChurchAndUser } from "@/lib/auth/church-context";

export async function searchLocations(query: string): Promise<{ ok: true; suggestions: Array<{ label: string; value: string }> } | { ok: false; error: string }> {
  try {
    const ctx = await requireChurchAndUser();
    if (!ctx.churchId) {
      return { ok: false, error: "Church ID not found" };
    }

    const db = createAdminClient();
    const suggestions = await getLocationSuggestions(ctx.churchId, query, db);

    return {
      ok: true,
      suggestions: suggestions.map(s => ({
        label: s.name,
        value: s.full_address,
      })),
    };
  } catch (error) {
    console.error("Location search error:", error);
    return { ok: false, error: "Failed to search locations" };
  }
}

export async function trackLocationUsage(location: string): Promise<{ ok: boolean }> {
  try {
    const ctx = await requireChurchAndUser();
    if (!ctx.churchId || !location) return { ok: false };

    const db = createAdminClient();
    await saveLocation(ctx.churchId, location, db);

    return { ok: true };
  } catch {
    return { ok: false };
  }
}
