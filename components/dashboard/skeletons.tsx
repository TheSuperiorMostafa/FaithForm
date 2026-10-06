import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { Clock, Phone, Share2, Presentation } from "lucide-react";
import { Card } from "@/components/ui/card";

export function HeroSkeleton() {
  return (
    <Card className="overflow-hidden border-0 p-0 shadow-card">
      <div className="space-y-4 bg-gradient-to-br from-accent/15 via-card to-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock className="size-5 text-accent" strokeWidth={1.75} aria-hidden />Hours saved
          </div>
          <div className="inline-flex rounded-full border border-border/80 bg-background/70 p-1 shadow-sm">
            {["Week", "Month", "All"].map((label) => <button key={label} type="button" disabled className="min-h-11 min-w-11 rounded-full px-3 py-1.5 text-xs font-semibold text-muted-foreground">{label}</button>)}
          </div>
        </div>
        <Skeleton className="h-14 w-48 md:h-16" />
        <Skeleton className="h-4 w-56" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>
      </div>
    </Card>
  );
}

export function StatRowSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {[
        { label: "Phone calls", icon: Phone },
        { label: "SM posts", icon: Share2 },
        { label: "PowerPoints created", icon: Presentation },
      ].map(({ label, icon: Icon }) => (
        <Card key={label} className="relative flex flex-col gap-2 overflow-hidden border-t-[3px] border-t-accent p-4 sm:p-5">
          <div className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Icon className="size-4" strokeWidth={1.75} aria-hidden />
          </div>
          <div className="pr-10">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <Skeleton className="mt-0.5 h-8 w-12 sm:h-9" />
            <Skeleton className="mt-0.5 h-4 w-24" />
          </div>
          <Skeleton className="h-9 w-full" />
        </Card>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="mb-2 h-5 w-40" />
      <Skeleton className="mb-6 h-4 w-64" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </Card>
  );
}

export function QuickActionsSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <div className="border-l-4 border-accent pl-3">
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="flex items-center gap-4 p-5">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function DashboardPageSkeleton() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-5xl flex-col gap-5"
      label="dashboard"
    >
      <HeroSkeleton />
      <StatRowSkeleton />
      <QuickActionsSkeleton />
      <ChartSkeleton />
    </SkeletonContainer>
  );
}


export function MetricsSkeleton() {
  return <SkeletonContainer label="Hours saved and activity" className="contents">
    <HeroSkeleton />
    <StatRowSkeleton />
  </SkeletonContainer>;
}
