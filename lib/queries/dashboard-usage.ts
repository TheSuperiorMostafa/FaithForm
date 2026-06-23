import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardUsageSummary = {
  pastorSeconds7d: number;
  pastorSeconds30d: number;
  hoursSavedMinutes30d: number;
  phoneCalls30d: number;
};

export type UserDashboardUsage = {
  seconds7d: number;
  seconds30d: number;
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
  const since7d = daysAgoDate(7);
  const since30d = daysAgoDate(30);
  const activitySince30d = new Date();
  activitySince30d.setDate(activitySince30d.getDate() - 30);

  const [usageRes, activityRes, phoneCallsRes] = await Promise.all([
    admin
      .from("dashboard_usage_daily")
      .select("usage_date, active_seconds")
      .eq("church_id", churchId)
      .gte("usage_date", since30d),
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

  let pastorSeconds7d = 0;
  let pastorSeconds30d = 0;

  for (const row of (usageRes.data ?? []) as {
    usage_date: string;
    active_seconds: number;
  }[]) {
    pastorSeconds30d += row.active_seconds ?? 0;
    if (row.usage_date >= since7d) {
      pastorSeconds7d += row.active_seconds ?? 0;
    }
  }

  const hoursSavedMinutes30d = (
    (activityRes.data ?? []) as { time_saved_minutes: number | null }[]
  ).reduce((sum, row) => sum + (row.time_saved_minutes ?? 0), 0);

  return {
    pastorSeconds7d,
    pastorSeconds30d,
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
  const since7d = daysAgoDate(7);
  const since30d = daysAgoDate(30);

  const { data, error } = await admin
    .from("dashboard_usage_daily")
    .select("user_id, usage_date, active_seconds, last_seen_at")
    .eq("church_id", churchId)
    .in("user_id", userIds)
    .gte("usage_date", since30d);

  if (error) {
    console.error("getUserDashboardUsageByChurch:", error.message);
    return usageByUser;
  }

  for (const userId of userIds) {
    usageByUser.set(userId, {
      seconds7d: 0,
      seconds30d: 0,
      lastSeenAt: null,
    });
  }

  for (const row of (data ?? []) as {
    user_id: string;
    usage_date: string;
    active_seconds: number;
    last_seen_at: string;
  }[]) {
    const current = usageByUser.get(row.user_id);
    if (!current) continue;

    current.seconds30d += row.active_seconds ?? 0;
    if (row.usage_date >= since7d) {
      current.seconds7d += row.active_seconds ?? 0;
    }

    if (
      !current.lastSeenAt ||
      new Date(row.last_seen_at) > new Date(current.lastSeenAt)
    ) {
      current.lastSeenAt = row.last_seen_at;
    }
  }

  return usageByUser;
}

export async function getPlatformDashboardUsageTotals(): Promise<{
  pastorSeconds30d: number;
  activeChurches30d: number;
}> {
  const admin = createAdminClient();
  const since30d = daysAgoDate(30);

  const { data, error } = await admin
    .from("dashboard_usage_daily")
    .select("church_id, active_seconds")
    .gte("usage_date", since30d);

  if (error) {
    console.error("getPlatformDashboardUsageTotals:", error.message);
    return { pastorSeconds30d: 0, activeChurches30d: 0 };
  }

  let pastorSeconds30d = 0;
  const churches = new Set<string>();

  for (const row of (data ?? []) as {
    church_id: string;
    active_seconds: number;
  }[]) {
    pastorSeconds30d += row.active_seconds ?? 0;
    if ((row.active_seconds ?? 0) > 0) {
      churches.add(row.church_id);
    }
  }

  return {
    pastorSeconds30d,
    activeChurches30d: churches.size,
  };
}
