import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";

/** Mirrors HeroHoursSaved: the compact "time saved" card. */
export function HeroSkeleton() {
  return (
    <Card className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-2xl" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <Skeleton className="h-12 w-32" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-auto h-11 w-full max-w-[280px] rounded-full" />
    </Card>
  );
}

/** Mirrors AttendanceChartSection. */
export function ChartSkeleton() {
  return (
    <Card>
      <div className="flex items-start gap-3 p-6 pb-2">
        <Skeleton className="size-12 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="px-6 pb-6 pt-4">
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </Card>
  );
}

/** Mirrors NeedsYou: the calm "all caught up" line is the common case. */
export function NeedsYouSkeleton() {
  return <Skeleton className="h-[58px] w-full rounded-2xl" />;
}

/** Mirrors QuickActionsSection's ActionCards. */
export function QuickActionsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="flex min-h-[152px] flex-col justify-between gap-5 p-5 sm:p-6">
          <Skeleton className="size-14 shrink-0 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-44" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/**
 * Home's loading state. Section headings are static text, so they render for
 * real; only the greeting (it carries the church name) and data shimmer.
 */
export function DashboardPageSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-10" label="Home">
      <div className="space-y-2.5">
        <Skeleton className="h-9 w-80 max-w-full sm:h-10" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Waiting on you" />
        <NeedsYouSkeleton />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="What would you like to do?" />
        <QuickActionsSkeleton />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="How things are going" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <HeroSkeleton />
          <ChartSkeleton />
        </div>
      </section>
    </SkeletonContainer>
  );
}
