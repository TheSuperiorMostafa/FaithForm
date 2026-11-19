import { Captions, Search, Upload } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const LIBRARY_TITLE = "Transcripts";
export const LIBRARY_DESCRIPTION =
  "Every service and uploaded video, written out word for word. Open one to find the sermon, make a lesson or make clips.";

/**
 * Shared row geometry, so the loading rows, the list and its live updates
 * line up exactly: a fixed-height status column and a fixed-width action
 * column mean progress turning into "Ready" never moves anything.
 */
export const ROW = {
  item: "flex flex-col sm:flex-row sm:items-center sm:gap-2",
  link: "flex min-h-[72px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-4 sm:px-4",
  icon: "flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent",
  side: "flex items-center gap-3 px-3 pb-3 sm:px-0 sm:pb-0 sm:pr-3",
  status: "flex min-h-16 min-w-0 flex-1 flex-col justify-center gap-1 sm:w-64 sm:flex-none",
  action: "flex w-36 shrink-0 items-center justify-end",
} as const;

export const SEARCH_BOX = "relative w-full sm:w-80";

/** The search box and count line above the list. */
export function LibraryToolbarSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className={SEARCH_BOX}>
        <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <div className="flex min-h-11 w-full items-center rounded-[10px] border-[1.5px] border-border bg-background py-3 pl-12 pr-4 text-[15px] text-muted-foreground shadow-sm">
          Find a service
        </div>
      </div>
      <Skeleton className="h-5 w-40" />
    </div>
  );
}

/** Placeholder rows, matching TranscriptRow. */
export function LibraryRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className={ROW.item}>
          <div className={cn(ROW.link, "hover:bg-transparent")}>
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className={cn("h-5", index % 2 === 0 ? "w-64" : "w-52", "max-w-full")} />
              <Skeleton className="h-4 w-56 max-w-full" />
            </div>
          </div>
          <div className={ROW.side}>
            <div className={ROW.status}>
              <Skeleton className="h-7 w-24 rounded-full" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className={ROW.action}>{index % 3 === 1 ? <Skeleton className="min-h-11 w-32 rounded-[10px]" /> : null}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The whole Transcripts page while it loads: real header, real search label. */
export function TranscriptLibrarySkeleton() {
  return (
    <SkeletonContainer label="transcripts" className="flex w-full flex-col gap-8">
      <PageHeader
        title={LIBRARY_TITLE}
        description={LIBRARY_DESCRIPTION}
        icon={Captions}
        action={
          <span className={buttonVariants({ size: "lg" })}>
            <Upload aria-hidden />
            Upload a video
          </span>
        }
      />
      <div className="flex flex-col gap-4">
        <LibraryToolbarSkeleton />
        <LibraryRowsSkeleton />
      </div>
    </SkeletonContainer>
  );
}
