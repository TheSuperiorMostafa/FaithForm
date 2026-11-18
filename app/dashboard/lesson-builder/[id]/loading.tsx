import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { LESSON_BACK_LABEL } from "@/lib/lesson-builder/page-copy";

/**
 * Mirrors `[id]/page.tsx`: back link, the lesson's title and passages (data,
 * so they shimmer), then the lesson card with its buttons, outline and
 * discussion questions.
 */
export default function LessonDetailLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="lesson">
      <SermonBackLinkStatic label={LESSON_BACK_LABEL} />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
      </header>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-5 w-64 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-52 rounded-[10px]" />
            <Skeleton className="h-11 w-44 rounded-[10px]" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-5 w-48 max-w-full" />
                <SkeletonText lines={3} />
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
            <Skeleton className="h-4 w-40" />
            <SkeletonText lines={4} />
          </div>
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
