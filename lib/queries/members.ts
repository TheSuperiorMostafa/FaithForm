import type { SupabaseClient } from "@supabase/supabase-js";

import { getDaysPresentByMember } from "@/lib/attendance/presence";

export type ChurchMember = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  is_active: boolean;
  /** Days at church by any method: the weekly sheet, the app, a code, the kiosk or a room. */
  attendance_count: number;
  /** The most recent of those days, as a local `YYYY-MM-DD`. */
  last_attended?: string | null;
  /** `app` when FaithForm created this record because someone joined in the app. */
  source?: "dashboard" | "app";
};

type GetMembersOptions = {
  includeInactive?: boolean;
  /**
   * Count attendance across every method rather than the weekly sheet alone.
   * One more aggregate over the church's history, so only pages that show
   * attendance ask for it — not the check-in desk.
   */
  includeAttendanceTotals?: boolean;
};

const MEMBER_COLUMNS =
  "id, first_name, last_name, phone, email, photo_url, is_active, attendance_entries(count)";

export async function getMembersForChurch(
  supabase: SupabaseClient,
  churchId: string,
  options: GetMembersOptions = {},
): Promise<ChurchMember[]> {
  const load = (columns: string) => {
    let query = supabase
      .from("members")
      .select(columns)
      .eq("church_id", churchId)
      .eq("attendance_entries.status", "present")
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (!options.includeInactive) {
      query = query.eq("is_active", true);
    }
    return query;
  };

  // `source` arrived with migration 0083. A database without it must still
  // list everyone, so the directory never goes blank during a deploy.
  let { data, error } = await load(`${MEMBER_COLUMNS}, source`);
  if (error && /source/i.test(error.message)) {
    ({ data, error } = await load(MEMBER_COLUMNS));
  }

  if (error) {
    console.error("getMembersForChurch:", error.message);
    return [];
  }

  // Every way someone can be recorded, counted once a day. Without 0083 the
  // weekly sheet's own count is all there is.
  const days = options.includeAttendanceTotals
    ? await getDaysPresentByMember(supabase, churchId)
    : null;

  type Row = {
    id: string;
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
    photo_url: string | null;
    is_active: boolean;
    source?: string | null;
    attendance_entries: { count: number }[] | null;
  };

  return ((data ?? []) as unknown as Row[]).map((member) => {
    const sheetCount = member.attendance_entries?.[0]?.count ?? 0;
    const presence = days?.get(member.id);
    return {
      id: member.id,
      first_name: member.first_name,
      last_name: member.last_name,
      phone: member.phone,
      email: member.email,
      photo_url: member.photo_url,
      is_active: member.is_active,
      attendance_count: days ? (presence?.days ?? 0) : sheetCount,
      last_attended: presence?.last ?? null,
      source: member.source === "app" ? "app" : "dashboard",
    };
  });
}
