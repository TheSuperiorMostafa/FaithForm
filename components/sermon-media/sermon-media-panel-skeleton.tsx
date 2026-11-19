import { ArrowRight, Captions } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export const PANEL_TITLE = "Transcript";
export const PANEL_DESCRIPTION = "Find the sermon, make a lesson and make clips in Transcripts.";

/** The compact card's frame, shared by the card and its loading state. */
export const PANEL_CARD =
  "flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between dark:shadow-none";

/** Mirrors SermonMediaPanel: icon, title, a status line and the Open button. */
export function SermonMediaPanelSkeleton() {
  return (
    <SkeletonContainer label="transcript status" className={PANEL_CARD}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <Captions className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="font-heading text-lg font-semibold">{PANEL_TITLE}</span>
          <div className="flex min-h-14 flex-col justify-center gap-1.5">
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
      </div>
      <span className={buttonVariants({ variant: "outline", className: "shrink-0" })}>
        Open transcript
        <ArrowRight aria-hidden />
      </span>
    </SkeletonContainer>
  );
}
