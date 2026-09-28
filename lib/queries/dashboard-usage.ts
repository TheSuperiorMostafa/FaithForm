import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { readAllById } from "@/lib/queries/paged-read";

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

type UsageRow = {
  id: string;
  user_id: string;
  usage_date: string;
  active_seconds: number;
  last_seen_at: string;
};

async function readChurchUsage(
  admin: SupabaseClient,
  churchId: string,
  since30d: string,
): Promise<UsageRow[]> {
  return readAllById<UsageRow>(
    async (afterId, includeCount, pageSize) => {
      let query = admin
        .from("dashboard_usage_daily")
        .select("id, user_id, usage_date, active_seconds, last_seen_at", {
          count: includeCount ? "exact" : undefined,
        })
        .eq("church_id", churchId)
        .gte("usage_date", since30d);
      if (afterId) query = query.gt("id", afterId);
      return await query.order("id", { ascending: true }).limit(pageSize);
    },
    { label: "dashboard usage", maxRows: 10_000 },
  );
}

async function readRecentActivityMinutes(
  admin: SupabaseClient,
  churchId: string,
  since: string,
): Promise<number> {
  const rows = await readAllById<{ id: string; time_saved_minutes: number | null }>(
    async (afterId, includeCount, pageSize) => {
      let query = admin
        .from("activity_log")
        .select("id, time_saved_minutes", { count: includeCount ? "exact" : undefined })
        .eq("church_id", churchId)
        .gte("executed_at", since);
      if (afterId) query = query.gt("id", afterId);
      return await query.order("id", { ascending: true }).limit(pageSize);
    },
    { label: "recent activity", maxRows: 10_000 },
  );
  return rows.reduce((sum, row) => sum + (row.time_saved_minutes ?? 0), 0);
}

export async function getChurchDashboardUsageSummary(
  churchId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<DashboardUsageSummary> {
  const since7d = daysAgoDate(7);
  const since30d = daysAgoDate(30);
  const activitySince30d = new Date();
  activitySince30d.setDate(activitySince30d.getDate() - 30);

  const [usageRows, hoursSavedMinutes30d, phoneCallsRes] = await Promise.all([
    readChurchUsage(admin, churchId, since30d),
    readRecentActivityMinutes(admin, churchId, activitySince30d.toISOString()),
    admin
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .eq("category", "Phone")
      .gte("executed_at", activitySince30d.toISOString()),
  ]);

  let pastorSeconds7d = 0;
  let pastorSeconds30d = 0;

  if (phoneCallsRes.error || !Number.isSafeInteger(phoneCallsRes.count)) {
    throw new Error("phone call activity count unavailable");
  }

  for (const row of usageRows) {
    pastorSeconds30d += row.active_seconds ?? 0;
    if (row.usage_date >= since7d) {
      pastorSeconds7d += row.active_seconds ?? 0;
    }
  }

  return {
    pastorSeconds7d,
    pastorSeconds30d,
    hoursSavedMinutes30d,
    phoneCalls30d: phoneCallsRes.count as number,
  };
}

export async function getUserDashboardUsageByChurch(
  churchId: string,
  userIds: string[],
  admin?: SupabaseClient,
): Promise<Map<string, UserDashboardUsage>> {
  const usageByUser = new Map<string, UserDashboardUsage>();
  if (userIds.length === 0) return usageByUser;
  const db = admin ?? createAdminClient();

  const since7d = daysAgoDate(7);
  const since30d = daysAgoDate(30);

  const data = await readChurchUsage(db, churchId, since30d);

  for (const userId of userIds) {
    usageByUser.set(userId, {
      seconds7d: 0,
      seconds30d: 0,
      lastSeenAt: null,
    });
  }

  for (const row of data) {
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
