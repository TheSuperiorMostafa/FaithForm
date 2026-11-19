import { CalendarDays, Clapperboard, Sparkles } from "lucide-react";

import { ClipsViewSkeleton, TabCountSkeleton } from "@/components/clips/clips-skeleton";
import { CLIPS_DESCRIPTION, CLIPS_TITLE, CLIPS_VIEW_LABELS, CLIPS_VIEWS } from "@/components/clips/format";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Mirrors the Clips page: header with its real buttons, the four tab labels
 * (counts shimmer), then the Ready to review grid of tall video cards.
 */
export default function ClipsLoading() {
  return (
    <SkeletonContainer label="Clips" className="flex w-full flex-col gap-8">
      <PageHeader
        title={CLIPS_TITLE}
        description={CLIPS_DESCRIPTION}
        icon={Clapperboard}
        secondary={
          <span aria-hidden className={buttonVariants({ size: "lg", variant: "outline" })}>
            <CalendarDays />
            Posting schedule
          </span>
        }
        action={
          <span aria-hidden className={buttonVariants({ size: "lg" })}>
            <Sparkles />
            Make clips
          </span>
        }
      />
      <div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div
            aria-hidden
            className="inline-flex min-h-11 w-full min-w-max items-center justify-start gap-1 border-b border-border text-muted-foreground"
          >
            {CLIPS_VIEWS.map((key, index) => (
              <span
                key={key}
                className={cn(
                  "relative inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-t-lg px-4 py-2 text-[15px] font-semibold after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full",
                  index === 0 ? "text-primary after:bg-accent dark:text-accent" : "after:bg-transparent",
                )}
              >
                {CLIPS_VIEW_LABELS[key]}
                <TabCountSkeleton />
              </span>
            ))}
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-6">
          <ClipsViewSkeleton view="review" />
        </div>
      </div>
    </SkeletonContainer>
  );
}
