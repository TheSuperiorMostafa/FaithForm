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

export type PersonGroupAvailability = { groupId: string; groupName: string; availability: string };

type AvailabilityRow = {
  member_id: string | null;
  group_id: string;
  availability: string | null;
  groups: { name: string | null; status: string | null } | { name: string | null; status: string | null }[] | null;
};

/** Groups the rows by person; drops blank text and archived groups. Exported for tests. */
export function groupAvailabilityByPerson(rows: AvailabilityRow[]): Map<string, PersonGroupAvailability[]> {
  const byPerson = new Map<string, PersonGroupAvailability[]>();
  for (const row of rows) {
    const text = row.availability?.trim() ?? "";
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    if (!row.member_id || !text || !group || group.status !== "active") continue;
    const list = byPerson.get(row.member_id) ?? [];
    list.push({ groupId: row.group_id, groupName: group.name ?? "Group", availability: text });
    byPerson.set(row.member_id, list);
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.groupName.localeCompare(b.groupName));
  return byPerson;
}

/**
 * Staff-side read: what each person (People `members.id`) said about when they
 * can serve, from every active group they belong to in one church.
 *
 * `churchId` must come from an authenticated staff context (for example
 * `requireGroupsStaff()` or the plans staff session), never from a request
 * body; every row is constrained to that church. People with nothing given
 * are simply absent from the map — render "No availability given" for them.
 */
export async function readAvailabilityForPeople(
  admin: SupabaseClient,
  churchId: string,
  memberIds: string[],
): Promise<Map<string, PersonGroupAvailability[]>> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await admin
    .from("group_memberships")
    .select("member_id, group_id, availability, groups(name, status)")
    .eq("church_id", churchId)
    .eq("status", "active")
    .in("member_id", ids)
    .neq("availability", "")
    .limit(5000);
  if (error) throw new VisitorError("unavailable", "Could not load availability.");
  return groupAvailabilityByPerson((data ?? []) as unknown as AvailabilityRow[]);
}
