import { LessonStartChoice } from "@/components/lesson-builder/lesson-start-choice";
import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonContainer } from "@/components/ui/skeleton";
import {
  LESSON_BACK_LABEL,
  NEW_LESSON_DESCRIPTION,
  NEW_LESSON_TITLE,
} from "@/lib/lesson-builder/page-copy";

/**
 * Mirrors `NewLessonForm` before a choice is made: the same header and the two
 * start choices, as real words. Nothing else shows until a choice is made, so
 * nothing here is waiting on data.
 */
export default function NewLessonLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="lesson form">
      <SermonBackLinkStatic label={LESSON_BACK_LABEL} />
      <PageHeader title={NEW_LESSON_TITLE} description={NEW_LESSON_DESCRIPTION} />

      <div className="flex flex-col gap-6">
        <LessonStartChoice value={null} disabled />
      </div>
    </SkeletonContainer>
  );
}
