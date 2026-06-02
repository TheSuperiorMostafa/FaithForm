import type { SupabaseClient } from "@supabase/supabase-js";

export type AttendanceReportMonth = {
  year: number;
  month: number;
  sundayCount: number;
  avgPresent: number;
};

export type TimeSavedReportMonth = {
  year: number;
  month: number;
  totalMinutes: number;
  runs: number;
};

export async function getCurrentChurchId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("church_users")
    .select("church_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCurrentChurchId:", error.message);
    return null;
  }

  return data?.church_id ?? null;
}

export async function getChurchName(
  supabase: SupabaseClient,
  churchId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("churches")
    .select("name")
    .eq("id", churchId)
    .maybeSingle();

  if (error || !data?.name) {
    console.error("getChurchName:", error?.message);
    return "Your Church";
  }

  return data.name;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

export async function getAttendanceReportMonths(
  supabase: SupabaseClient,
  churchId: string,
): Promise<AttendanceReportMonth[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("service_date, total_present")
    .eq("church_id", churchId)
    .order("service_date", { ascending: false });

  if (error) {
    console.error("getAttendanceReportMonths:", error.message);
    return [];
  }

  const buckets = new Map<
    string,
    { year: number; month: number; presentSum: number; count: number }
  >();

  for (const row of data ?? []) {
    const [y, m] = row.service_date.split("-").map(Number);
    const key = `${y}-${m}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.presentSum += row.total_present ?? 0;
      existing.count += 1;
    } else {
      buckets.set(key, {
        year: y,
        month: m,
        presentSum: row.total_present ?? 0,
        count: 1,
      });
    }
  }

  return Array.from(buckets.values())
    .map((b) => ({
      year: b.year,
      month: b.month,
      sundayCount: b.count,
      avgPresent: b.count > 0 ? Math.round(b.presentSum / b.count) : 0,
    }))
    .sort((a, b) => b.year - a.year || b.month - a.month);
}

export async function getTimeSavedReportMonths(
  supabase: SupabaseClient,
  churchId: string,
): Promise<TimeSavedReportMonth[]> {
  const { data, error } = await supabase
    .from("activity_log")
    .select("executed_at, time_saved_minutes")
    .eq("church_id", churchId)
    .order("executed_at", { ascending: false });

  if (error) {
    console.error("getTimeSavedReportMonths:", error.message);
    return [];
  }

  const buckets = new Map<
    string,
    { year: number; month: number; totalMinutes: number; runs: number }
  >();

  for (const row of data ?? []) {
    const d = new Date(row.executed_at);
    const key = monthKeyFromDate(d);
    const existing = buckets.get(key);
    const minutes = row.time_saved_minutes ?? 0;
    if (existing) {
      existing.totalMinutes += minutes;
      existing.runs += 1;
    } else {
      buckets.set(key, {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        totalMinutes: minutes,
        runs: 1,
      });
    }
  }

  return Array.from(buckets.values()).sort(
    (a, b) => b.year - a.year || b.month - a.month,
  );
}
