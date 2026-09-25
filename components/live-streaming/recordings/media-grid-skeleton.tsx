import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Loading state for the series and topic pages under Recordings: the back
 * link, a heading, one line, and a grid of tiles in the page's own shape.
 */
export function MediaGridSkeleton({
  label,
  backLabel = "Back to Series",
  shape = "wide",
  withPanel = false,
}: {
  label: string;
  backLabel?: string;
  shape?: "wide" | "poster";
  /** The series page shows its artwork panel above the grid. */
  withPanel?: boolean;
}) {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label={label}>
      <div className="flex flex-col gap-3">
        <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
          ← {backLabel}
        </span>
        <div className="flex flex-col gap-1">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
      </div>

      {withPanel ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <Skeleton className="mb-5 h-5 w-36" />
          <div className="grid gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="aspect-video w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={
          shape === "poster"
            ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
            : "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {Array.from({ length: shape === "poster" ? 10 : 6 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton
              className="w-full rounded-xl"
              style={{ aspectRatio: shape === "poster" ? "4 / 5" : "16 / 9" }}
            />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </SkeletonContainer>
  );
}
