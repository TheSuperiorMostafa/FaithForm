import type { SupabaseClient } from "@supabase/supabase-js";
import { computeHoursSaved, inHoursSavedWindow } from "@/lib/reports/hours-saved";

export type AttendanceReportMonth = {
  year: number;
  month: number;
  sundayCount: number;
  avgPresent: number;
};

export type MonthlyReportMonth = {
  year: number;
  month: number;
  totalMinutes: number;
  tasks: number;
  calls: number;
};

/** @deprecated Use MonthlyReportMonth */
export type TimeSavedReportMonth = MonthlyReportMonth & { runs: number };

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

function addMonthKey(keys: Set<string>, iso: string | null | undefined) {
  if (!iso) return;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return;
  keys.add(monthKeyFromDate(d));
}

export async function getMonthlyReportMonths(
  supabase: SupabaseClient,
  churchId: string,
): Promise<MonthlyReportMonth[]> {
  const monthKeys = new Set<string>();

  const [activityRes, phoneRes, attRes, annRes, sermonsRes, assetsRes] =
    await Promise.all([
      supabase
        .from("activity_log")
        .select("executed_at")
        .eq("church_id", churchId),
      supabase
        .from("phone_calls")
        .select("called_at")
        .eq("church_id", churchId),
      supabase
        .from("attendance_records")
        .select("service_date, submitted_at")
        .eq("church_id", churchId),
      supabase
        .from("announcements")
        .select("created_at")
        .eq("church_id", churchId),
      supabase
        .from("sermons")
        .select(
          "created_at, outline_generated_at, content_generated_at, published_at",
        )
        .eq("church_id", churchId),
      supabase
        .from("sermon_assets")
        .select("created_at, sermons!inner(church_id)")
        .eq("sermons.church_id", churchId),
    ]);

  for (const row of activityRes.data ?? []) {
    addMonthKey(monthKeys, row.executed_at as string);
  }
  for (const row of phoneRes.data ?? []) {
    addMonthKey(monthKeys, row.called_at as string);
  }
  for (const row of attRes.data ?? []) {
    addMonthKey(
      monthKeys,
      (row.submitted_at as string | null) ??
        `${row.service_date as string}T12:00:00Z`,
    );
  }
  for (const row of annRes.data ?? []) {
    addMonthKey(monthKeys, row.created_at as string);
  }
  for (const row of sermonsRes.data ?? []) {
    const s = row as {
      created_at: string;
      outline_generated_at: string | null;
      content_generated_at: string | null;
      published_at: string | null;
    };
    addMonthKey(monthKeys, s.created_at);
    addMonthKey(monthKeys, s.outline_generated_at);
    addMonthKey(monthKeys, s.content_generated_at);
    addMonthKey(monthKeys, s.published_at);
  }
  for (const row of assetsRes.data ?? []) {
    addMonthKey(monthKeys, row.created_at as string);
  }

  const months = Array.from(monthKeys)
    .map((key) => {
      const [year, month] = key.split("-").map(Number);
      return { year, month };
    })
    .sort((a, b) => b.year - a.year || b.month - a.month);

  const results: MonthlyReportMonth[] = [];

  for (const { year, month } of months) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const stats = await computeHoursSaved(supabase, churchId, { start, end });
    const calls = ((phoneRes.data ?? []) as { called_at: string | null }[]).filter(
      (r) => inHoursSavedWindow(r.called_at, start, end),
    ).length;

    results.push({
      year,
      month,
      totalMinutes: stats.minutes,
      tasks: stats.tasks,
      calls,
    });
  }

  return results;
}

/** @deprecated Use getMonthlyReportMonths */
export async function getTimeSavedReportMonths(
  supabase: SupabaseClient,
  churchId: string,
): Promise<TimeSavedReportMonth[]> {
  const months = await getMonthlyReportMonths(supabase, churchId);
  return months.map((m) => ({ ...m, runs: m.tasks }));
}
