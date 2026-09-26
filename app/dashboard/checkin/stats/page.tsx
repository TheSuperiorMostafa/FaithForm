import { redirect } from "next/navigation";

import { LocationStatsTable } from "@/components/checkin/location-stats-table";
import { NoCodeReleaseLog } from "@/components/checkin/no-code-release-log";
import { getChurchAuth } from "@/lib/auth/church";
import { recentServiceWeeks, serviceWeekStart } from "@/lib/checkin/service-week";
import { getLocationStats, listNoCodeReleases } from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function CheckinStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  if (await pageFeatureBlocked("checkin")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const { weeks: weeksParam } = await searchParams;
  const weeks = Math.min(Math.max(Number(weeksParam) || 8, 4), 26);

  const supabase = createClient();
  const endWeekStart = serviceWeekStart(auth.churchTimezone);
  // The log covers exactly the weeks the numbers above it do.
  const sinceServiceDate = recentServiceWeeks(endWeekStart, weeks)[0];

  const [{ weeks: weekStarts, rows }, noCode] = await Promise.all([
    getLocationStats(auth.churchId, { weeks, endWeekStart, strict: true }, supabase),
    // Not strict: if only the log fails, the numbers still show.
    listNoCodeReleases(auth.churchId, { sinceServiceDate }, supabase),
  ]);

  return (
    <div className="flex w-full flex-col gap-8">
      <LocationStatsTable weeks={weekStarts} rows={rows} weekCount={weeks} />
      <NoCodeReleaseLog
        releases={noCode.releases}
        total={noCode.total}
        failed={noCode.failed}
        weekCount={weeks}
        timeZone={auth.churchTimezone}
      />
    </div>
  );
}
