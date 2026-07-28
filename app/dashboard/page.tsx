import { Suspense } from "react";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { AttendanceChartSection } from "@/components/dashboard/attendance-chart-section";
import { HeroHoursSaved } from "@/components/dashboard/hero-hours-saved";
import {
  QuickActionsSection,
  hasQuickActions,
} from "@/components/dashboard/quick-actions-section";
import {
  ChartSkeleton,
  HeroSkeleton,
  StatRowSkeleton,
} from "@/components/dashboard/skeletons";
import { StatRow } from "@/components/dashboard/stat-row";
import { getFeatureAccess } from "@/lib/features/access";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentChurchId,
  parseDashboardRange,
} from "@/lib/queries/dashboard";

type PageProps = {
  searchParams: { range?: string };
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const churchId = await getCurrentChurchId(supabase, user.id);
  const range = parseDashboardRange(searchParams.range);
  const featureAccess = await getFeatureAccess(supabase);
  const allowedFeatures = featureAccess?.allowed ?? [];

  if (!churchId) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          No church linked yet
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Your account is not linked to a church yet. Contact support to connect
          your church before using the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
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
