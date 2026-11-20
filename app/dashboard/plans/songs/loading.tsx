import { ArrowLeft, ChevronRight, FileSpreadsheet, FileUp, Music, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { FILTER_LABELS, SONGS_DESCRIPTION, SONGS_TITLE } from "@/lib/service-plans/songs/page-copy";
import { cn } from "@/lib/utils";

const FIELD =
  "flex min-h-11 w-full items-center rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-muted-foreground shadow-sm dark:bg-input";

/** Mirrors `page.tsx`: back link, header and its buttons, filters, song rows. */
export default function SongLibraryLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="song library">
      <div className="flex flex-col gap-4">
        <span aria-hidden className={cn(buttonVariants({ variant: "link" }), "w-fit")}>
          <ArrowLeft className="size-4" />
          Service Plans
        </span>
        <PageHeader
          title={SONGS_TITLE}
          description={SONGS_DESCRIPTION}
          icon={Music}
          secondary={
            <>
              <span aria-hidden className={buttonVariants({ variant: "outline", size: "lg" })}>
                <FileUp className="size-5" />
                Import
              </span>
              <span aria-hidden className={buttonVariants({ variant: "outline", size: "lg" })}>
                <FileSpreadsheet className="size-5" />
                Usage report
              </span>
            </>
          }
          action={
            <span aria-hidden className={buttonVariants({ size: "lg" })}>
              <Plus className="size-5" />
              Add song
            </span>
          }
        />
      </div>

      <section aria-hidden className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          {FILTER_LABELS.map((label, i) => (
            <div key={label} className={cn("space-y-2", i === 0 && "sm:col-span-2 lg:col-span-1")}>
              <span className="block text-sm font-semibold leading-none text-foreground">{label}</span>
              <span className={FIELD}>{i === 0 ? "Title, writer or CCLI number" : ""}</span>
            </div>
          ))}
        </div>

        <div className="flex h-[22.5px] items-center">
          <Skeleton className="h-4 w-20" />
        </div>

        <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-2 rounded-2xl">
              <div className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4">
                <Skeleton className="size-12 shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-56 max-w-full" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="hidden h-7 w-28 rounded-full sm:block" />
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </SkeletonContainer>
  );
}
