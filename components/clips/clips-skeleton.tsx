import type { ReactNode } from "react";

import { CLIPS_DESCRIPTION, CLIPS_TITLE } from "@/components/clips/format";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const CLIP_GRID = "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3";
export const CLIP_CARD = "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card dark:shadow-none";
export const CLIP_ROW_LIST = "divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm";

/** One review card: the 9:16 video, then service, reason, Facebook text and actions. */
function ReviewCardSkeleton() {
  return (
    <div className={CLIP_CARD} aria-hidden>
      <Skeleton className="aspect-[9/16] w-full rounded-none" />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
        <SkeletonText lines={2} lastLineWidth="w-2/3" />
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-medium">Text for Facebook</span>
          <Skeleton className="h-[116px] w-full rounded-[10px]" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
        <Skeleton className="min-h-12 w-full rounded-[10px]" />
        <div className="flex gap-3">
          <Skeleton className="min-h-11 flex-1 rounded-[10px]" />
          <Skeleton className="min-h-11 flex-1 rounded-[10px]" />
        </div>
      </div>
    </div>
  );
}

/** A Scheduled / Posted / Skipped row: thumbnail, when, text, actions. */
function RowSkeleton() {
  return (
    <li className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:p-4" aria-hidden>
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Skeleton className="aspect-[9/16] w-16 shrink-0 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-48 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-40 max-w-full" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="min-h-11 w-32 rounded-[10px]" />
        <Skeleton className="min-h-11 w-28 rounded-[10px]" />
      </div>
    </li>
  );
}

export function ClipsViewSkeleton({ view, className }: { view: "review" | "scheduled" | "posted" | "skipped"; className?: string }) {
  if (view === "review" || view === "skipped") {
    return (
      <div className={cn(CLIP_GRID, className)}>
        <ReviewCardSkeleton />
        <div className="hidden sm:block">
          <ReviewCardSkeleton />
        </div>
        <div className="hidden lg:block">
          <ReviewCardSkeleton />
        </div>
      </div>
    );
  }
  return (
    <ul className={cn(CLIP_ROW_LIST, className)} aria-hidden>
      <RowSkeleton />
      <RowSkeleton />
      <RowSkeleton />
    </ul>
  );
}

/** Used inside the client while a tab's first load is on its way. */
export function ClipsViewLoading({ view }: { view: "review" | "scheduled" | "posted" | "skipped" }) {
  return (
    // No fade delay: it follows the route skeleton directly, so a gap would flash.
    <SkeletonContainer label="clips" delay={false}>
      <ClipsViewSkeleton view={view} />
    </SkeletonContainer>
  );
}

/** Count chip placeholder in a tab label; same box as the real count. */
export function TabCountSkeleton() {
  return <Skeleton className="ml-2 inline-block h-6 w-7 rounded-full align-middle" />;
}

/**
 * The Clips view's first row under the recording filters: what it is, then
 * the posting schedule and the one primary action. Shared with the route
 * skeleton so both draw the same box.
 */
export function ClipsHeaderRow({ secondary, action }: { secondary: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="sr-only">{CLIPS_TITLE}</h2>
        <p className="max-w-2xl text-[15px] text-muted-foreground">{CLIPS_DESCRIPTION}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {secondary}
        {action}
      </div>
    </div>
  );
}
