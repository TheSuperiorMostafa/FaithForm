import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { RECORDING_FILTERS } from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

/**
 * Mirrors the Recordings tab: the three filter chips and the search box (real labels, counts
 * shimmer) and the list of big recording rows — thumbnail, title, date,
 * status badge, next-action button.
 */
export default function RecordingsLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-6"
      label="recordings"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {RECORDING_FILTERS.map((filter, index) => (
            <span
              key={filter.key}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-[15px] font-semibold",
                index === 0
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground/80",
              )}
            >
              {filter.label}
              {filter.key !== "series" ? (
                <Skeleton className="h-6 w-7 rounded-full" />
              ) : null}
            </span>
          ))}
        </div>
        <Skeleton className="min-h-11 w-full rounded-[10px] sm:w-72" />
      </div>

      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
        {Array.from({ length: 5 }).map((_, index) => (
          <li
            key={index}
            className="flex flex-col gap-3 p-2 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="flex min-h-[88px] min-w-0 flex-1 items-center gap-4 p-2">
              <Skeleton className="aspect-video w-28 shrink-0 rounded-xl sm:w-40" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-3/4 max-w-72" />
                <Skeleton className="h-4 w-44" />
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-3 px-2 pb-2 sm:p-0 sm:pr-3">
              <Skeleton className="hidden h-8 w-36 rounded-full sm:block" />
              <Skeleton className="min-h-11 w-40 rounded-[10px]" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonContainer>
  );
}
