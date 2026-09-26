import { Download, MonitorPlay } from "lucide-react";
import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors `[id]/page.tsx`: back link, the sermon's title and date (data, so
 * they shimmer), the status row, the Slides / Lesson tabs and
 * the Slides tab's buttons and preview.
 */
export default function SermonDetailLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="sermon">
      <SermonBackLinkStatic label="Back to Sermons" />

      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2.5">
            <Skeleton className="h-9 w-72 max-w-full" />
            <Skeleton className="h-5 w-96 max-w-full" />
          </div>
          <Skeleton className="h-12 w-52 rounded-[10px]" />
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
      </div>

      <div>
        <div className="flex min-h-11 w-full items-center justify-start gap-1 border-b border-border text-muted-foreground">
          <span className="inline-flex min-h-11 items-center px-4 py-2 text-[15px] font-semibold text-primary dark:text-accent">
            Slides
          </span>
          <span className="inline-flex min-h-11 items-center px-4 py-2 text-[15px] font-semibold">
            Lesson
          </span>
        </div>

        <div className="mt-6 flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden className={buttonVariants({ size: "lg", className: "opacity-50" })}>
              <MonitorPlay className="size-5" />
              Present
            </span>
            <span aria-hidden className={buttonVariants({ variant: "outline", size: "lg", className: "opacity-50" })}>
              <Download className="size-5" />
              Download PowerPoint
            </span>
          </div>
          <p className="text-[15px] text-muted-foreground">
            Present shows the slides full screen. Use the arrow keys or click to
            move between slides, and press Esc to finish.
          </p>
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
