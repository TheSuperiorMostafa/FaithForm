import { GraduationCap, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { LESSONS_DESCRIPTION, LESSONS_TITLE } from "@/lib/lesson-builder/page-copy";

/** Mirrors `page.tsx`: header with its real button, then the list's big rows. */
export default function LessonBuilderLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="lessons">
      <PageHeader
        title={LESSONS_TITLE}
        description={LESSONS_DESCRIPTION}
        icon={GraduationCap}
        action={
          <span aria-hidden className={buttonVariants({ size: "lg" })}>
            <Plus className="size-5" />
            New lesson
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        <ul
          aria-hidden
          className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex min-h-[72px] items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
              <Skeleton className="size-14 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SkeletonContainer>
  );
}
