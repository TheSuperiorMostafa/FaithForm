import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a check-in room id from a form is one of this church's rooms.
 *
 * Rooms are written by id with the service role, and the foreign key only
 * proves the room exists somewhere — so a child's default room, or the room a
 * child is moved to, could otherwise be another church's.
 */
export async function isChurchLocation(
  db: SupabaseClient,
  churchId: string,
  locationId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("church_locations")
    .select("id")
    .eq("id", locationId)
    .eq("church_id", churchId)
    .maybeSingle();
  return !error && Boolean(data);
}
