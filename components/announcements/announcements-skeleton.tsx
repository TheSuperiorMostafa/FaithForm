import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export function AnnouncementsHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
    </div>
  );
}

export function WeeklyQueueSectionSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex w-full items-center gap-3">
          <Skeleton className="size-5 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
      </section>
    </div>
  );
}

export function CalendarSectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* Month navigation toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Skeleton className="size-9 rounded-md" />
          <div className="flex min-w-[10rem] justify-center">
            <Skeleton className="h-6 w-36" />
          </div>
          <Skeleton className="size-9 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      {/* Two-column calendar + inspector layout */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
        {/* Left column: Calendar Grid */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-card dark:shadow-none">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-border bg-primary text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div
                  key={day}
                  className="px-2 py-3 text-center font-heading text-sm font-semibold uppercase tracking-wide opacity-80"
                >
                  <span className="hidden sm:inline">{day}</span>
                  <span className="sm:hidden">{day.slice(0, 1)}</span>
                </div>
              ))}
            </div>

            {/* 35 month grid cells (5 weeks x 7 days) */}
            <div className="grid grid-cols-7">
              {Array.from({ length: 35 }).map((_, index) => (
                <div
                  key={index}
                  className="min-h-[7rem] border-b border-r border-border p-1.5 sm:min-h-[9rem] lg:min-h-[10.5rem] xl:min-h-[11rem]"
                >
                  <Skeleton className="size-8 rounded-full" />
                  {/* Subtle placeholder chips in scattered cells to mimic active calendar */}
                  {index % 4 === 1 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      <Skeleton className="h-5 w-full rounded-md" />
                    </div>
                  )}
                  {index % 7 === 0 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      <Skeleton className="h-5 w-full rounded-md" />
                      <Skeleton className="h-5 w-4/5 rounded-md" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>

        {/* Right column: Sticky Day Inspection Card */}
        <div className="w-full scroll-mt-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader className="space-y-1.5">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-60 max-w-full" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-48" />
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-40" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function PublishedSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-6 w-32" />
      </div>
    </section>
  );
}

export function AnnouncementsPageSkeleton() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-5"
      label="announcements"
    >
      <AnnouncementsHeaderSkeleton />
      <WeeklyQueueSectionSkeleton />
      <CalendarSectionSkeleton />
      <PublishedSectionSkeleton />
    </SkeletonContainer>
  );
}
