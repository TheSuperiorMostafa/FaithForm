"use server";

import { z } from "zod";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export type MemberGroup = { id: string; name: string; archived: boolean };
export type MemberGroupsResult =
  | { ok: true; available: boolean; groups: MemberGroup[] }
  | { ok: false; error: string };

/** Existing membership facts, with the same church/Groups grant as staff rosters. */
export async function getMemberGroups(memberId: string): Promise<MemberGroupsResult> {
  try {
    const auth = await getChurchAuth();
    if (!auth) return { ok: false, error: "You must be signed in." };
    const peopleError = await featureActionError("people");
    if (peopleError) return { ok: false, error: peopleError };
    if (await featureActionError("groups")) return { ok: true, available: false, groups: [] };
    if (!z.guid().safeParse(memberId).success) return { ok: false, error: "That person could not be found." };

    const db = createAdminClient();
    const { data: member, error: memberError } = await db.from("members").select("id")
      .eq("id", memberId).eq("church_id", auth.churchId).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return { ok: false, error: "That person could not be found." };

    const { data, error } = await db.from("group_memberships")
      .select("group_id, groups!inner(id, name, status, church_id)")
      .eq("church_id", auth.churchId).eq("member_id", memberId).eq("status", "active")
      .eq("groups.church_id", auth.churchId).neq("groups.status", "deleted").limit(5000);
    if (error) throw error;
    const groups = new Map<string, MemberGroup>();
    for (const row of data ?? []) {
      const group = (Array.isArray(row.groups) ? row.groups[0] : row.groups) as { id: string; name: string; status: string; church_id: string } | null;
      if (group?.church_id === auth.churchId && group.status !== "deleted") {
        groups.set(group.id, { id: group.id, name: group.name, archived: group.status === "archived" });
      }
    }
    return { ok: true, available: true, groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  } catch {
    return { ok: false, error: "We couldn't load this person's groups. Try again." };
  }
}
