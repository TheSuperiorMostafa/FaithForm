import { Users } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";

function RowSkeleton() {
  return (
    <div className="flex min-h-[72px] items-center gap-4 rounded-2xl px-4 py-3">
      <Skeleton className="size-12 shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-40 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <Skeleton className="hidden h-8 w-28 rounded-full sm:block" />
    </div>
  );
}

/**
 * Services, loading. Mirrors `services/page.tsx`: the list of services beside
 * the "Choose a service" panel, which is static until one is picked.
 */
export default function ServicesLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="services">
      <PageHeader title={ATTENDANCE_COPY.services.title} description={ATTENDANCE_COPY.services.description} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-3">
            <p className="font-heading text-xl font-bold text-foreground">Open and coming up</p>
            <div className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
              {Array.from({ length: 2 }).map((_, index) => (
                <RowSkeleton key={index} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <p className="font-heading text-xl font-bold text-foreground">Recent</p>
            <div className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
              {Array.from({ length: 4 }).map((_, index) => (
                <RowSkeleton key={index} />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <span
              aria-hidden
              className="flex size-14 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              <Users className="size-7" strokeWidth={1.5} />
            </span>
            <p className="font-heading text-lg font-bold text-foreground">Choose a service</p>
            <p className="max-w-sm text-[15px] text-muted-foreground">
              Pick a service from the list to see who came and how, or to mark people by hand.
            </p>
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
