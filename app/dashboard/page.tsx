import { LiveAttendanceRefresh } from "@/components/attendance/live-attendance-refresh";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Church } from "lucide-react";

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
} from "@/components/dashboard/skeletons";
import {
  GettingStartedCard,
  GettingStartedSkeleton,
} from "@/components/setup/getting-started-card";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { parseDashboardRange } from "@/lib/queries/dashboard";

type PageProps = {
  searchParams: Promise<{ range?: string }>;
};

function greeting(timeZone: string, now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function isSundayIn(timeZone: string, now = new Date()): boolean {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(now) === "Sun";
}

/**
 * Home is a launchpad, not an analytics wall: what is waiting on you, the
 * things you do most as big buttons, then a light look at how the church is
 * doing.
 */
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
  const timeZone = auth.churchTimezone ?? "America/New_York";

  if (!churchId) {
    return (
      <EmptyState
        icon={Church}
        title="Your account isn't connected to a church yet"
        description="Starting a new church on FaithForm? Set it up now, it takes a minute. Joining an existing church? Ask its admin to invite you."
        action={
          <Link href="/setup" className={buttonVariants({ size: "lg" })}>
            Set up your church
          </Link>
        }
      />
    );
  }

  const sunday = isSundayIn(timeZone);

  return (
    <div className="flex w-full flex-col gap-10">
      <LiveAttendanceRefresh />

      <PageHeader
        title={`${greeting(timeZone)}${auth.churchName ? `, ${auth.churchName}` : ""}`}
        description={
          sunday
            ? "It's Sunday. Everything you need for today is right here."
            : "Here's what needs you, and the things you do most."
        }
      />

      <Suspense fallback={<GettingStartedSkeleton />}>
        <GettingStartedCard
          churchId={churchId}
          allowedFeatures={allowedFeatures}
          isAdmin={auth.isAdmin}
        />
      </Suspense>

      <section aria-labelledby="needs-you" className="flex flex-col gap-4">
        <SectionHeader id="needs-you" title="Waiting on you" />
        <Suspense fallback={<NeedsYouSkeleton />}>
          <NeedsYou churchId={churchId} allowedFeatures={allowedFeatures} />
        </Suspense>
      </section>

      {hasQuickActions(allowedFeatures) && (
        <section aria-labelledby="quick-actions" className="flex flex-col gap-4">
          <SectionHeader id="quick-actions" title="What would you like to do?" />
          <QuickActionsSection allowedFeatures={allowedFeatures} isSunday={sunday} />
        </section>
      )}

      <section aria-labelledby="how-its-going" className="flex flex-col gap-4">
        <SectionHeader id="how-its-going" title="How things are going" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <Suspense fallback={<HeroSkeleton />}>
            <HeroHoursSaved churchId={churchId} range={range} />
          </Suspense>
          <Suspense fallback={<ChartSkeleton />}>
            <AttendanceChartSection churchId={churchId} />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
