import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { TranscriptLinesSkeleton } from "@/components/sermon-media/transcript-viewer";

export const PANEL_TITLE = "Sermon transcript, lesson and clips";
export const PANEL_DESCRIPTION =
  "Find the sermon in this recording, turn it into a small-group lesson, and make short clips for Facebook.";

/**
 * Mirrors SermonMediaPanel: header, transcript status card, player + sermon
 * times beside the transcript, the lesson card and the clips list. Headings
 * and labels are real text; only the recording's data shimmers.
 */
export function SermonMediaPanelSkeleton() {
  return (
    <SkeletonContainer label="sermon transcript" className="flex flex-col gap-6">
      <SectionHeader title={PANEL_TITLE} description={PANEL_DESCRIPTION} />

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between dark:shadow-none">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-[30px] w-28 rounded-full" />
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
        <Skeleton className="min-h-11 w-36 shrink-0 rounded-[10px]" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-6 w-56 max-w-full" />
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

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
        <div className="space-y-1">
          <span className="block font-heading text-lg font-semibold">Make a lesson from this sermon</span>
          <span className="block text-[15px] text-muted-foreground">
            FaithForm writes a small-group lesson from what was preached. You can edit it before you share it.
          </span>
        </div>
        <Skeleton className="min-h-11 w-56 rounded-[10px]" />
      </div>

      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <span className="block font-heading text-lg font-semibold">Short clips for Facebook</span>
          <span className="block text-[15px] text-muted-foreground">
            Short moments from the sermon, made into vertical videos you can post as Reels.
          </span>
        </div>
        <Skeleton className="h-[160px] w-full rounded-3xl" />
      </div>
    </SkeletonContainer>
  );
}
