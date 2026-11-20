import { ArrowLeft, Download } from "lucide-react";

import { TranscriptLinesSkeleton } from "@/components/sermon-media/transcript-viewer";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export const BACK_LABEL = "Back to the recording";

/**
 * Mirrors the transcript page under Live > Recordings: back link, title and
 * date, the player and sermon times beside the transcript, then the folded
 * transcript options. Labels and buttons are real text; only the recording's
 * data shimmers. The route's loading.tsx wraps it in SkeletonContainer.
 */
export function TranscriptDetailSkeletonBody() {
  return (
    <>
      <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {BACK_LABEL}
      </span>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Skeleton className="h-9 w-96 max-w-full" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
        <span className={buttonVariants({ variant: "outline" })}>
          <Download aria-hidden />
          Download transcript
        </span>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <div className="flex flex-col gap-1">
              <span className="block font-heading text-lg font-semibold">Sermon times</span>
              <SkeletonText lines={2} size="sm" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="min-h-11 w-32 rounded-[10px]" />
              <Skeleton className="min-h-11 w-32 rounded-[10px]" />
            </div>
          </div>
        </div>

        <div className="flex max-h-[min(80dvh,46rem)] min-h-[24rem] flex-col rounded-2xl border border-border bg-card shadow-card dark:shadow-none">
          <div className="flex shrink-0 flex-col gap-3 border-b border-border p-5">
            <div className="space-y-0.5">
              <span className="block font-heading text-lg font-semibold">Transcript</span>
              <span className="block text-sm text-muted-foreground">Press a time to play the recording from there.</span>
            </div>
            <Skeleton className="min-h-11 w-full rounded-[10px]" />
          </div>
          <div className="min-h-0 flex-auto overflow-hidden p-3">
            <TranscriptLinesSkeleton />
          </div>
        </div>
      </div>

      <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
        <span className="text-[15px] font-semibold">More transcript options</span>
      </div>
    </>
  );
}
