import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
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
  searchParams: Promise<{ weeks?: string; releases?: string; page?: string }>;
}) {
  if (await pageFeatureBlocked("checkin")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const { weeks: weeksParam, releases, page: pageParam } = await searchParams;
  const showAll = releases === "all";
  const requestedPage = Number(pageParam);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.min(10000, Math.floor(requestedPage))) : 1;
  const limit = showAll ? 50 : 10;
  const offset = showAll ? (page - 1) * limit : 0;
  const weeks = Math.min(Math.max(Number(weeksParam) || 8, 4), 26);

  const supabase = createClient();
  const endWeekStart = serviceWeekStart(auth.churchTimezone);
  // The log covers exactly the weeks the numbers above it do.
  const sinceServiceDate = recentServiceWeeks(endWeekStart, weeks)[0];

  const [{ weeks: weekStarts, rows }, noCode] = await Promise.all([
    getLocationStats(auth.churchId, { weeks, endWeekStart, strict: true }, supabase),
    // Not strict: if only the log fails, the numbers still show.
    listNoCodeReleases(auth.churchId, { sinceServiceDate, limit, offset }, supabase),
  ]);

  return (
    <div className="flex w-full flex-col gap-8">
      <LocationStatsTable weeks={weekStarts} rows={rows} weekCount={weeks} />
      <NoCodeReleaseLog
        releases={noCode.releases}
        total={noCode.total}
        failed={noCode.failed}
        weekCount={weeks}
        offset={offset}
        timeZone={auth.churchTimezone}
        viewAllHref={showAll ? undefined : `/dashboard/checkin/stats?weeks=${weeks}&releases=all`}
      />
      {showAll && !noCode.failed ? (
        <nav className="flex flex-wrap gap-3" aria-label="Release log pages">
          <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/checkin/stats?weeks=${weeks}`}>Show latest 10</Link>
          {page > 1 ? <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/checkin/stats?weeks=${weeks}&releases=all&page=${page - 1}`}>Newer releases</Link> : null}
          {offset + limit < noCode.total ? <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/checkin/stats?weeks=${weeks}&releases=all&page=${page + 1}`}>Older releases</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
