import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the Upcoming tab: the section header (real text), the list of
 * services as 72px rows, and the folded slides section.
 */
export default function UpcomingServicesLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="upcoming services">
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-heading text-xl font-bold text-foreground">Upcoming services</h2>
            <p className="text-[15px] text-muted-foreground">
              Schedule a service so Go live is ready with its name, and your watch page shows a countdown.
            </p>
          </div>
          <Skeleton className="min-h-12 w-52 rounded-[10px]" />
        </div>

        <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 3 }).map((_, index) => (
            <li
              key={index}
              className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-4">
                <Skeleton className="size-11 shrink-0 rounded-xl" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-64 max-w-full" />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="min-h-11 w-40 rounded-[10px]" />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card/50">
        <div className="flex min-h-12 items-center justify-between gap-3 px-5 py-3">
          <span className="space-y-0.5">
            <span className="block text-[15px] font-semibold text-foreground">Show sermon slides during a service</span>
            <span className="block text-sm text-muted-foreground">
              Link a sermon&apos;s slides so people can open them while they watch.
            </span>
          </span>
          <Skeleton className="size-5 rounded-md" />
        </div>
      </div>
    </SkeletonContainer>
  );
}
