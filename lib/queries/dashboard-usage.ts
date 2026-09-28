import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardUsageSummary = {
  hoursSavedMinutes30d: number;
  phoneCalls30d: number;
};

export type UserDashboardUsage = {
  lastSeenAt: string | null;
};

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function getChurchDashboardUsageSummary(
  churchId: string,
): Promise<DashboardUsageSummary> {
  const admin = createAdminClient();
  const activitySince30d = new Date();
  activitySince30d.setDate(activitySince30d.getDate() - 30);

  const [activityRes, phoneCallsRes] = await Promise.all([
    admin
      .from("activity_log")
      .select("time_saved_minutes")
      .eq("church_id", churchId)
      .gte("executed_at", activitySince30d.toISOString()),
    admin
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .eq("category", "Phone")
      .gte("executed_at", activitySince30d.toISOString()),
  ]);

  const hoursSavedMinutes30d = (
    (activityRes.data ?? []) as { time_saved_minutes: number | null }[]
  ).reduce((sum, row) => sum + (row.time_saved_minutes ?? 0), 0);

  return {
    hoursSavedMinutes30d,
    phoneCalls30d: phoneCallsRes.count ?? 0,
  };
}

export async function getUserDashboardUsageByChurch(
  churchId: string,
  userIds: string[],
): Promise<Map<string, UserDashboardUsage>> {
  const usageByUser = new Map<string, UserDashboardUsage>();
  if (userIds.length === 0) return usageByUser;

  const admin = createAdminClient();
  const since30d = daysAgoDate(30);

  const { data, error } = await admin
    .from("dashboard_usage_daily")
    .select("user_id, last_seen_at")
    .eq("church_id", churchId)
    .in("user_id", userIds)
    .gte("usage_date", since30d);

  if (error) {
    console.error("getUserDashboardUsageByChurch:", error.message);
    return usageByUser;
  }

  for (const userId of userIds) {
    usageByUser.set(userId, {
      lastSeenAt: null,
    });
  }

  for (const row of (data ?? []) as {
    user_id: string;
    last_seen_at: string;
  }[]) {
    const current = usageByUser.get(row.user_id);
    if (!current) continue;

    if (
      !current.lastSeenAt ||
      new Date(row.last_seen_at) > new Date(current.lastSeenAt)
    ) {
      current.lastSeenAt = row.last_seen_at;
    }
  }

  return usageByUser;
}
