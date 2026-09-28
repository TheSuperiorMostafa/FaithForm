import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** Read all ordered pages when an aggregate or church roster is not available. */
export async function loadAllAdminPages<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function isMissingAdminAggregate(message: string): boolean {
  return /PGRST202|42883|could not find the function|does not exist/i.test(message);
}

export type AdminPlatformTotals = {
  minutesSaved: number;
  givingCents: number;
  pastorSeconds30d: number;
  activeChurches30d: number;
};

/** Request-scoped so the overview and giving cards share one database result. */
export const getAdminPlatformTotals = cache(async (): Promise<AdminPlatformTotals> => {
  const admin = createAdminClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const { data, error } = await admin.rpc("admin_platform_totals", {
    since_date: sinceDate,
  });

  if (!error) {
    const row = (data as Record<string, unknown>[] | null)?.[0];
    if (!row) throw new Error("admin_platform_totals returned no row");
    return {
      minutesSaved: Number(row.minutes_saved ?? 0),
      givingCents: Number(row.giving_cents ?? 0),
      pastorSeconds30d: Number(row.pastor_seconds_30d ?? 0),
      activeChurches30d: Number(row.active_churches_30d ?? 0),
    };
  }
  if (!isMissingAdminAggregate(error.message)) {
    throw new Error(`admin_platform_totals: ${error.message}`);
  }

  // The web deploy can precede 0112. Keep its totals complete during that
  // narrow window instead of silently stopping at PostgREST's first 1,000 rows.
  const churches = await loadAllAdminPages<{ id: string; exclude_from_platform_metrics: boolean }>(
    "churches", (from, to) => admin.from("churches")
      .select("id, exclude_from_platform_metrics").order("id").range(from, to),
  );
  const includedIds = new Set(churches.filter((row) => !row.exclude_from_platform_metrics).map((row) => row.id));
  const [activity, gifts, usage] = await Promise.all([
    loadAllAdminPages<{ church_id: string; time_saved_minutes: number | null }>("activity_log", (from, to) =>
      admin.from("activity_log").select("church_id, time_saved_minutes").order("id").range(from, to),
    ),
    loadAllAdminPages<{ church_id: string; amount_cents: number }>("giving_donations", (from, to) =>
      admin.from("giving_donations").select("church_id, amount_cents").eq("status", "succeeded")
        .order("id").range(from, to),
    ),
    loadAllAdminPages<{ church_id: string; active_seconds: number }>("dashboard_usage_daily", (from, to) =>
      admin.from("dashboard_usage_daily").select("church_id, active_seconds")
        .gte("usage_date", sinceDate).order("usage_date").order("church_id")
        .order("user_id").range(from, to),
    ),
  ]);
  return {
    minutesSaved: activity.reduce((sum, row) => sum + (includedIds.has(row.church_id) ? row.time_saved_minutes ?? 0 : 0), 0),
    givingCents: gifts.reduce((sum, row) => sum + (includedIds.has(row.church_id) ? row.amount_cents : 0), 0),
    pastorSeconds30d: usage.reduce((sum, row) => sum + (includedIds.has(row.church_id) ? row.active_seconds ?? 0 : 0), 0),
    activeChurches30d: new Set(usage.filter((row) => includedIds.has(row.church_id) && row.active_seconds > 0).map((row) => row.church_id)).size,
  };
});
