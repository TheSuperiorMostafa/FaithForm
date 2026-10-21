import { isCompletedPhoneCall } from "@/lib/integrations/retell-call-model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { automationDisplayLabel } from "@/lib/reports/automation-labels";
import {
  computeHoursSaved,
  inHoursSavedWindow,
  toHoursSaved,
  topAutomationsFromMap,
} from "@/lib/reports/hours-saved";
import { getChurchName } from "@/lib/queries/library";
import { formatMonthLabel, formatHoursComparison } from "@/lib/utils/reports";

export type MonthlyReportData = {
  churchName: string;
  monthLabel: string;
  hoursSavedThisMonth: number;
  hoursComparison: string;
  tasksCompletedThisMonth: number;
  callsHandledThisMonth: number;
  lifetimeHoursSaved: number;
  lifetimeTasksCompleted: number;
  lifetimeRentalsBooked: number;
  topAutomations: { rank: number; label: string; minutes: number }[];
  narrative: string;
  reportDate: string;
};

type PhoneCallRow = { called_at: string | null; call_type: string | null; caller_number?: string | null; provider_call_type?: string | null; call_status?: string | null };

async function countPhoneCallsInWindow(
  supabase: SupabaseClient,
  churchId: string,
  start: Date | null,
  end: Date,
): Promise<number> {
  const { data } = await supabase
    .from("phone_calls")
    .select("called_at, call_type, caller_number, provider_call_type, call_status")
    .eq("church_id", churchId);

  return ((data ?? []) as PhoneCallRow[]).filter((r) =>
    isCompletedPhoneCall(r) && inHoursSavedWindow(r.called_at, start, end),
  ).length;
}

async function countLifetimeRentals(
  supabase: SupabaseClient,
  churchId: string,
): Promise<number> {
  const [activityRes, phoneRes] = await Promise.all([
    supabase
      .from("activity_log")
      .select("automation_type")
      .eq("church_id", churchId)
      .eq("automation_type", "Rental Booked"),
    supabase
      .from("phone_calls")
      .select("call_type")
      .eq("church_id", churchId),
  ]);

  const fromActivity = (activityRes.data ?? []).length;
  const fromCalls = ((phoneRes.data ?? []) as { call_type: string | null }[]).filter(
    (r) => r.call_type?.toLowerCase().includes("rental"),
  ).length;

  return fromActivity + fromCalls;
}

function buildNarrative(
  tasks: number,
  calls: number,
  hours: number,
): string {
  const hoursLabel = hours.toFixed(2);
  return (
    `This month your system completed ${tasks} task${tasks === 1 ? "" : "s"} and handled ${calls} call${calls === 1 ? "" : "s"}, saving you ${hoursLabel} hour${hours === 1 ? "" : "s"} for ministry. ` +
    "The system is running strong and as this number grows, so does the time your church gets back."
  );
}

export async function getMonthlyReportData(
  supabase: SupabaseClient,
  churchId: string,
  year: number,
  month: number,
  phoneClient: SupabaseClient = supabase,
): Promise<MonthlyReportData> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const now = new Date();

  const [churchName, monthStats, lifetimeStats, callsThisMonth, rentals, previousStats] =
    await Promise.all([
      getChurchName(supabase, churchId),
      computeHoursSaved(supabase, churchId, {
        start: monthStart,
        end: monthEnd,
      }, phoneClient),
      computeHoursSaved(supabase, churchId, {
        start: null,
        end: now,
      }, phoneClient),
      countPhoneCallsInWindow(phoneClient, churchId, monthStart, monthEnd),
      countLifetimeRentals(phoneClient, churchId),
      computeHoursSaved(supabase, churchId, { start: new Date(year, month - 2, 1), end: monthStart }, phoneClient),
    ]);

  const hoursSavedThisMonth = toHoursSaved(monthStats.minutes);
  const lifetimeHoursSaved = toHoursSaved(lifetimeStats.minutes);
  const monthLabel = formatMonthLabel(year, month);

  const topAutomations = topAutomationsFromMap(
    monthStats.automationMinutes,
    5,
  ).map((row) => ({
    rank: row.rank,
    label: automationDisplayLabel(row.automationType),
    minutes: row.minutes,
  }));

  const reportDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(now);

  return {
    churchName,
    monthLabel,
    hoursSavedThisMonth,
    hoursComparison: formatHoursComparison(hoursSavedThisMonth, toHoursSaved(previousStats.minutes)),
    tasksCompletedThisMonth: monthStats.tasks,
    callsHandledThisMonth: callsThisMonth,
    lifetimeHoursSaved,
    lifetimeTasksCompleted: lifetimeStats.tasks,
    lifetimeRentalsBooked: rentals,
    topAutomations,
    narrative: buildNarrative(
      monthStats.tasks,
      callsThisMonth,
      hoursSavedThisMonth,
    ),
    reportDate,
  };
}
