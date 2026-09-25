import { LiveAttendanceRefresh } from "@/components/attendance/live-attendance-refresh";
import { Suspense } from "react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { AttendanceChartSection } from "@/components/dashboard/attendance-chart-section";
import { HeroHoursSaved } from "@/components/dashboard/hero-hours-saved";
import { NeedsYou } from "@/components/dashboard/needs-you";
import {
  QuickActionsSection,
  hasQuickActions,
} from "@/components/dashboard/quick-actions-section";
import {
  ChartSkeleton,
  HeroSkeleton,
  NeedsYouSkeleton,
  StatRowSkeleton,
} from "@/components/dashboard/skeletons";
import { StatRow } from "@/components/dashboard/stat-row";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { parseDashboardRange } from "@/lib/queries/dashboard";

type PageProps = {
  searchParams: Promise<{ range?: string }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const [query, auth, featureAccess] = await Promise.all([
    searchParams,
    getChurchAuth(),
    getFeatureAccess(),
  ]);

  if (!auth) {
    redirect("/login");
  }

  const churchId = auth.churchId;
  const range = parseDashboardRange(query.range);
  const allowedFeatures = featureAccess?.allowed ?? [];

  if (!churchId) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          No church linked yet
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Starting a new church on FaithForm? Set it up now — it takes a
          minute. Joining an existing one? Ask its admin to invite you from
          Settings &rsaquo; Team.
        </p>
        <a
          href="/setup"
          className="mt-2 inline-flex h-11 items-center rounded-[10px] bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Set up your church
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <LiveAttendanceRefresh />
      <section aria-labelledby="needs-you" className="flex flex-col gap-3">
        <h2
          id="needs-you"
          className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground"
        >
          Waiting on you
        </h2>
        <Suspense fallback={<NeedsYouSkeleton />}>
          <NeedsYou churchId={churchId} allowedFeatures={allowedFeatures} />
        </Suspense>
      </section>
      <Suspense fallback={<HeroSkeleton />}>
        <HeroHoursSaved churchId={churchId} range={range} />
      </Suspense>

      <Suspense fallback={<StatRowSkeleton />}>
        <StatRow churchId={churchId} range={range} />
      </Suspense>

      {hasQuickActions(allowedFeatures) && (
        <section className="flex flex-col gap-3">
          <h2 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
            Your Weekly Inputs
          </h2>
          <QuickActionsSection
            churchId={churchId}
            allowedFeatures={allowedFeatures}
          />
        </section>
      )}

      <Suspense fallback={<ChartSkeleton />}>
        <AttendanceChartSection churchId={churchId} />
      </Suspense>
    </div>
  );
}
