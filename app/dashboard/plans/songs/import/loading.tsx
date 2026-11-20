import { ArrowLeft, FileUp } from "lucide-react";
import { CcliNote } from "@/components/service-plans/songs/ccli-note";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonContainer } from "@/components/ui/skeleton";
import { IMPORT_DESCRIPTION, IMPORT_TITLE } from "@/lib/service-plans/songs/page-copy";
import { cn } from "@/lib/utils";

/**
 * Mirrors `import/page.tsx`. Nothing on it is loaded from the database, so
 * every part renders as real, static content.
 */
export default function ImportSongsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="song import">
      <div className="flex flex-col gap-4">
        <span aria-hidden className={cn(buttonVariants({ variant: "link" }), "w-fit")}>
          <ArrowLeft className="size-4" />
          Song library
        </span>
        <PageHeader title={IMPORT_TITLE} description={IMPORT_DESCRIPTION} icon={FileUp} />
      </div>
      <CcliNote />
      <section aria-hidden className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-border bg-card/60 px-6 py-12 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent">
            <FileUp className="size-8" strokeWidth={1.5} />
          </span>
          <div className="max-w-lg space-y-1.5">
            <span className="block font-heading text-xl font-bold text-foreground">Choose song files</span>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              ChordPro, OnSong, SongSelect downloads (.usr or the lyrics .txt) and spreadsheets (.csv with a Title
              column). You can pick many at once, or drag them here. You’ll check every song before anything is saved.
            </p>
          </div>
          <span className={buttonVariants({ size: "lg" })}>
            <FileUp className="size-5" />
            Choose files
          </span>
        </div>
      </section>
    </SkeletonContainer>
  );
}
