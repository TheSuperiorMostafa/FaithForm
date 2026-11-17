"use server";

import { searchPlaceSuggestions, resolvePlaceAddress } from "@/lib/announcements/place-suggestions";
import { loadStaffGroup, requireGroupsStaff } from "@/lib/groups/staff/context";
import { formatAddressLine } from "@/lib/utils/address";

/** Meetings use their own staff guard, without exposing the Announcements address library. */
export async function searchGroupMeetingLocations(groupId: string, query: string, sessionToken?: string) {
  try {
    const ctx = await requireGroupsStaff();
    await loadStaffGroup(ctx, groupId);
    if (typeof query !== "string" || query.trim().length < 3 || query.length > 200) {
      return { ok: true as const, suggestions: [], addressSearch: "ready" as const };
    }
    const result = await searchPlaceSuggestions(query, sessionToken);
    return { ok: true as const, suggestions: result.suggestions, addressSearch: result.status };
  } catch {
    return { ok: false as const, error: "Address suggestions couldn't load. You can still type the full address." };
  }
}

export async function resolveGroupMeetingLocation(groupId: string, placeId: string, sessionToken?: string) {
  try {
    const ctx = await requireGroupsStaff();
    await loadStaffGroup(ctx, groupId);
    return await resolvePlaceAddress(placeId, sessionToken);
  } catch {
    return { ok: false as const, error: "We couldn't load that address. Choose it again or add the street address." };
  }
}

export async function getGroupMeetingChurchAddress(groupId: string) {
  try {
    const ctx = await requireGroupsStaff();
    await loadStaffGroup(ctx, groupId);
    const { data, error } = await ctx.admin.from("churches")
      .select("name, address, city, state, zip").eq("id", ctx.churchId).maybeSingle();
    if (error || !data) return { ok: false as const, error: "We couldn't load the church address. Type it here or try again." };
    const address = formatAddressLine(data);
    if (!address) return { ok: false as const, error: "Add your church address in Settings first, or type a location here." };
    return { ok: true as const, value: [data.name?.trim(), address].filter(Boolean).join(", ") };
  } catch {
    return { ok: false as const, error: "We couldn't load the church address. Type it here or try again." };
  }
}
