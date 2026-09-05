import { redirect } from "next/navigation";

import { LocationStatsTable } from "@/components/checkin/location-stats-table";
import { getChurchAuth } from "@/lib/auth/church";
import { serviceWeekStart } from "@/lib/checkin/service-week";
import { getLocationStats } from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CheckinStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const { weeks: weeksParam } = await searchParams;
  const weeks = Math.min(Math.max(Number(weeksParam) || 8, 4), 26);

  const { weeks: weekStarts, rows } = await getLocationStats(
    auth.churchId,
    { weeks, endWeekStart: serviceWeekStart(auth.churchTimezone) },
    createClient(),
  );

  return <LocationStatsTable weeks={weekStarts} rows={rows} weekCount={weeks} />;
}
