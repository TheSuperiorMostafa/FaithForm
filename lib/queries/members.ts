import type { SupabaseClient } from "@supabase/supabase-js";

export type ChurchMember = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  is_active: boolean;
  attendance_count: number;
};

type GetMembersOptions = {
  includeInactive?: boolean;
};

export async function getMembersForChurch(
  supabase: SupabaseClient,
  churchId: string,
  options: GetMembersOptions = {},
): Promise<ChurchMember[]> {
  let query = supabase
    .from("members")
    .select("id, first_name, last_name, phone, email, photo_url, is_active")
    .eq("church_id", churchId)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (!options.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getMembersForChurch:", error.message);
    return [];
  }

  const members = data ?? [];

  const { data: presentEntries, error: countsError } = await supabase
    .from("attendance_entries")
    .select("member_id")
    .eq("church_id", churchId)
    .eq("status", "present")
    .not("member_id", "is", null);

  if (countsError) {
    console.error("getMembersForChurch counts:", countsError.message);
  }

  const countByMember = new Map<string, number>();
  for (const entry of presentEntries ?? []) {
    if (!entry.member_id) continue;
    countByMember.set(
      entry.member_id,
      (countByMember.get(entry.member_id) ?? 0) + 1,
    );
  }

  return members.map((member) => ({
    ...member,
    attendance_count: countByMember.get(member.id) ?? 0,
  }));
}
