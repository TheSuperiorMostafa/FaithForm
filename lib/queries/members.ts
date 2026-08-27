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
    .select(
      "id, first_name, last_name, phone, email, photo_url, is_active, attendance_entries(count)",
    )
    .eq("church_id", churchId)
    .eq("attendance_entries.status", "present")
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

  return (data ?? []).map((member) => {
    const counts = member.attendance_entries as
      | { count: number }[]
      | null;
    return {
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      phone: member.phone,
      email: member.email,
      photo_url: member.photo_url,
      is_active: member.is_active,
      attendance_count: counts?.[0]?.count ?? 0,
    };
  });
}
