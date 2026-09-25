import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { ONBOARDING_STEP_LABELS } from "@/components/onboarding/step-labels";
import { cn } from "@/lib/utils";

/**
 * Mirrors `OnboardingWizard`: the same 560px column, the progress row with
 * its step labels (fixed text, so real), then the step card with the same
 * padding. Only what depends on the invite (which step, the church's name)
 * shimmers.
 */
export default function OnboardingLoading() {
  return (
    <SkeletonContainer className="w-full max-w-[560px]" label="Setup">
      <div className="w-full">
        <div className="mb-2 flex items-center justify-between text-base">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" />
        <div className="mt-3 hidden justify-between gap-1 sm:flex" aria-hidden>
          {ONBOARDING_STEP_LABELS.map((label) => (
            <span key={label} className="flex-1 truncate text-center text-sm text-muted-foreground">
              {label}
            </span>
          ))}
        </div>
      </div>

      <Card
        className={cn(
          "mt-6 overflow-hidden rounded-[20px] border-border shadow-card",
          "px-4 py-8 sm:px-10 sm:py-10",
        )}
      >
        <div className="space-y-6">
          <div>
            <Skeleton className="h-8 w-3/4 sm:h-9" />
            <SkeletonText lines={2} lastLineWidth="w-5/6" size="base" className="mt-3" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
          </div>
          <Skeleton className="h-12 w-full rounded-[10px]" />
        </div>
      </Card>
    </SkeletonContainer>
  );
}
