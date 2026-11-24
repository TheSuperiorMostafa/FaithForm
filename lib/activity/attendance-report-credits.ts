import type { SupabaseClient } from "@supabase/supabase-js";

import { logActivity } from "@/lib/activity/log";
import { newlyAvailableAttendancePeriods } from "@/lib/notifications/staff-preferences";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAttendancePeriod } from "@/lib/utils/reports";

const REPORT_TYPE = {
  month: "Monthly Attendance Report",
  quarter: "Quarterly Attendance Report",
  year: "Annual Attendance Report",
} as const;

/** One credit per church and report period; matches the backfill in migration 0177. */
export function attendanceReportTrigger(period: string): string {
  return `attendance_report:${period}`;
}

/**
 * Credits the monthly, quarterly, and annual attendance reports FaithForm makes
 * for a church on the day each period's report becomes available (the 1st, in
 * the church's time zone), when the church recorded attendance in that period.
 *
 * Runs from the staff-notifications cron. Once a period is credited, later
 * runs that day cost one lookup.
 */
export async function creditAttendanceReports(now = new Date(), client?: SupabaseClient): Promise<number> {
  const admin = client ?? createAdminClient();
  const { data: churches, error } = await admin.from("churches").select("id, timezone");
  if (error) throw new Error("attendance_report_credits_unavailable");

  const due: { churchId: string; period: string }[] = [];
  for (const church of (churches ?? []) as { id: string; timezone: string | null }[]) {
    for (const period of newlyAvailableAttendancePeriods(church.timezone ?? "America/New_York", now)) {
      due.push({ churchId: church.id, period });
    }
  }
  if (due.length === 0) return 0;

  const triggers = Array.from(new Set(due.map((d) => attendanceReportTrigger(d.period))));
  const { data: done } = await admin
    .from("activity_log")
    .select("church_id, trigger_source")
    .in("trigger_source", triggers);
  const credited = new Set(
    ((done ?? []) as { church_id: string; trigger_source: string }[]).map((r) => `${r.church_id}|${r.trigger_source}`),
  );

  let added = 0;
  for (const { churchId, period } of due) {
    const trigger = attendanceReportTrigger(period);
    if (credited.has(`${churchId}|${trigger}`)) continue;
    const parsed = parseAttendancePeriod(period);
    if (!parsed) continue;
    const { count } = await admin
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .gte("service_date", parsed.startDateIso)
      .lt("service_date", parsed.endDateIso);
    if (!count) continue;
    await logActivity({
      churchId,
      automationType: REPORT_TYPE[parsed.kind],
      taskName: `${parsed.label} attendance report`,
      triggerSource: trigger,
    }, admin);
    added += 1;
  }
  return added;
}
