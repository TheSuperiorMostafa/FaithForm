import { BookOpen, Layers, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { SERMONS_DESCRIPTION, SERMONS_TITLE } from "@/lib/sermon-builder/page-copy";

/** Mirrors `page.tsx`: header with its real buttons, the two tabs, big rows. */
export default function SermonBuilderLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="sermons">
      <PageHeader
        title={SERMONS_TITLE}
        description={SERMONS_DESCRIPTION}
        icon={BookOpen}
        secondary={
          <span aria-hidden className={buttonVariants({ variant: "outline", size: "lg" })}>
            <Layers className="size-5" />
            New series
          </span>
        }
        action={
          <span aria-hidden className={buttonVariants({ size: "lg" })}>
            <Plus className="size-5" />
            New sermon
          </span>
        }
      />

      <div>
        <div className="inline-flex min-h-11 items-center gap-1 border-b border-border text-muted-foreground">
          <span className="inline-flex min-h-11 items-center px-4 py-2 text-[15px] font-semibold text-primary dark:text-accent">
            Sermons
            <Skeleton className="ml-2 h-4 w-8" />
          </span>
          <span className="inline-flex min-h-11 items-center px-4 py-2 text-[15px] font-semibold">
            Series
            <Skeleton className="ml-2 h-4 w-6" />
          </span>
        </div>

        <ul className="mt-6 divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex min-h-[80px] items-center gap-4 px-4 py-3">
              <Skeleton className="size-14 shrink-0 rounded-2xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              <Skeleton className="hidden h-7 w-24 rounded-full sm:block" />
            </li>
          ))}
        </ul>
      </div>
    </SkeletonContainer>
  );
}
