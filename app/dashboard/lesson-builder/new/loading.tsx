import { BookOpen, Sparkles } from "lucide-react";
import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import {
  LESSON_BACK_LABEL,
  NEW_LESSON_DESCRIPTION,
  NEW_LESSON_TITLE,
} from "@/lib/lesson-builder/page-copy";

function FieldSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-medium leading-none">{label}</p>
      <Skeleton className="h-11 w-full rounded-[10px]" />
    </div>
  );
}

/** Mirrors `NewLessonForm`: the same cards, labels and button; only fields shimmer. */
export default function NewLessonLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="lesson form">
      <SermonBackLinkStatic label={LESSON_BACK_LABEL} />
      <PageHeader title={NEW_LESSON_TITLE} description={NEW_LESSON_DESCRIPTION} />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Lesson details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FieldSkeleton label="Lesson title" />
            <div className="space-y-2">
              <FieldSkeleton label="Lesson date" />
              <p className="text-sm text-muted-foreground">
                The day you&rsquo;ll teach it. We picked the next Sunday for you.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
              Bible passages
            </CardTitle>
            <p className="text-[15px] text-muted-foreground">
              Choose the book, chapter and verses the lesson teaches from.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <FieldSkeleton label="Bible translation" />
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              {["Book", "Chapter", "Verse", "To"].map((label) => (
                <FieldSkeleton key={label} label={label} />
              ))}
              <div className="flex items-end">
                <Skeleton className="h-11 w-full rounded-[10px] sm:w-20" />
              </div>
            </div>
            <Skeleton className="h-4 w-80 max-w-full" />
          </CardContent>
        </Card>

        <div>
          <span aria-hidden className={buttonVariants({ size: "lg", className: "opacity-50" })}>
            <Sparkles className="size-5" />
            Make the lesson
          </span>
        </div>
      </div>
    </SkeletonContainer>
  );
}
