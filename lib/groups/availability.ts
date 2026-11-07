import type { SupabaseClient } from "@supabase/supabase-js";
import { VisitorError } from "@/lib/faithform/errors";

/** The scope is resolved from the authenticated caller's live membership, never a body field. */
export async function readOrSaveAvailability(admin: SupabaseClient, scope: {
  churchId: string; groupId: string; membershipId: string | null; groupStatus: string;
}, value?: string): Promise<{ availability: string }> {
  if (!scope.membershipId) throw new VisitorError("forbidden", "Join the group to set availability.");
  if (value !== undefined && value.trim().length > 500) throw new VisitorError("invalid_input", "Keep availability to 500 characters.");
  if (value !== undefined && scope.groupStatus !== "active") throw new VisitorError("conflict", "Restore this group before changing availability.");
  const table = admin.from("group_memberships");
  const command = value === undefined ? table.select("availability") : table.update({ availability: value.trim() });
  const query = command.eq("id", scope.membershipId).eq("church_id", scope.churchId).eq("group_id", scope.groupId).eq("status", "active");
  const { error, data } = await (value === undefined ? query : query.select("availability")).maybeSingle();
  if (error) throw new VisitorError("unavailable", value === undefined ? "Could not load your availability." : "Could not save your availability.");
  if (!data) throw new VisitorError("forbidden", "Your group membership has changed.");
  const row = data as { availability?: string | null };
  return { availability: row.availability ?? "" };
}
