import { Archive, ArrowLeft, ChevronDown, ChevronRight, Link2, Music, Plus, Save, Trash2, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ARRANGEMENTS_DESCRIPTION, SONG_SECTIONS } from "@/lib/service-plans/songs/page-copy";
import { cn } from "@/lib/utils";

const FIELD =
  "flex min-h-11 w-full items-center rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 shadow-sm dark:bg-input";

function Field({ label, className, value = "w-32" }: { label: string; className?: string; value?: string | null }) {
  return (
    <div className={cn("space-y-2", className)}>
      <span className="block text-sm font-semibold leading-none text-foreground">{label}</span>
      <span className={FIELD}>{value ? <Skeleton className={cn("h-4 max-w-full", value)} /> : null}</span>
    </div>
  );
}

/** Mirrors `[songId]/page.tsx`: details and usage side by side, then arrangements. */
export default function SongLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="song">
      <div className="flex flex-col gap-4">
        <span aria-hidden className={cn(buttonVariants({ variant: "link" }), "w-fit")}>
          <ArrowLeft className="size-4" />
          Song library
        </span>
        <PageHeader
          title={<Skeleton className="h-9 w-64 max-w-full" />}
          description={<Skeleton className="mt-1 h-5 w-80 max-w-full" />}
          icon={Music}
        />
      </div>

      <div aria-hidden className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="flex flex-col gap-4">
          <SectionHeader title={SONG_SECTIONS.details} />
          <div className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Title" className="sm:col-span-2" value="w-48" />
              <Field label="Writers" className="sm:col-span-2" value="w-64" />
              <Field label="CCLI song number" value="w-20" />
              <Field label="Copyright" value="w-36" />
              <Field label="Usual key" value="w-8" />
              <Field label="Tempo (BPM)" value="w-10" />
              <div className="space-y-2 sm:col-span-2">
                <span className="block text-sm font-semibold leading-none text-foreground">Tags</span>
                <span className={FIELD}>
                  <Skeleton className="h-4 w-40" />
                </span>
                <p className="text-sm text-muted-foreground">Separate tags with commas.</p>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <span className={buttonVariants({ variant: "ghost" })}>
                <Archive className="size-5" />
                Remove from library
              </span>
              <span className={buttonVariants()}>
                <Save className="size-5" />
                Save song details
              </span>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionHeader title={SONG_SECTIONS.usage} description={<Skeleton className="h-4 w-40" />} />
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-2 rounded-2xl">
                <div className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-3 py-2">
                  <Skeleton className="size-10 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32 max-w-full" />
                    <Skeleton className="h-3.5 w-48 max-w-full" />
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-hidden className="flex flex-col gap-4">
        <SectionHeader title={SONG_SECTIONS.arrangements} description={ARRANGEMENTS_DESCRIPTION} />
        <div className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Name" className="sm:col-span-2 lg:col-span-1" value="w-20" />
              <Field label="Key" value="w-8" />
              <Field label="Length" value="w-10" />
              <Field label="BPM" value="w-10" />
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-semibold leading-none text-foreground">Order of sections</span>
              <span className={FIELD}>
                <Skeleton className="h-4 w-80 max-w-full" />
              </span>
              <p className="text-sm text-muted-foreground">Separate sections with commas.</p>
            </div>
            <div className="space-y-2">
              <span className="block text-sm font-semibold leading-none text-foreground">Chord chart</span>
              <span className="block h-[346px] w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 shadow-sm">
                <span className="block space-y-3">
                  {["w-16", "w-72", "w-64", "w-56", "w-24", "w-16", "w-72", "w-60"].map((w, i) => (
                    <Skeleton key={i} className={cn("h-3.5 max-w-full", w)} />
                  ))}
                </span>
              </span>
              <p className="text-sm text-muted-foreground">
                Put chords in square brackets before the word, or on their own line above it.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card/50">
              <div className="flex min-h-12 items-center justify-between gap-3 px-5 py-3">
                <span className="space-y-0.5">
                  <span className="block text-[15px] font-semibold text-foreground">Lyrics</span>
                  <span className="block text-sm text-muted-foreground">
                    Words only, without chords, for slides and printouts.
                  </span>
                </span>
                <ChevronDown className="size-5 shrink-0 text-muted-foreground" />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <span className={buttonVariants({ variant: "ghost" })}>
                <Trash2 className="size-5" />
                Delete arrangement
              </span>
              <span className={buttonVariants()}>
                <Save className="size-5" />
                Save arrangement
              </span>
            </div>
          </div>
          <div className="space-y-4 border-t border-border pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-heading text-lg font-bold text-foreground">Files and links</span>
              <span className={buttonVariants({ variant: "outline" })}>
                <Upload className="size-5" />
                Upload a file
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Chord chart PDFs, lead sheets and rehearsal tracks, up to 20 MB each.
            </p>
            <Skeleton className="h-[68px] w-full rounded-2xl" />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-2">
                <span className="block text-sm font-semibold leading-none text-foreground">
                  Link to a recording or chart
                </span>
                <span className={cn(FIELD, "text-[15px] text-muted-foreground")}>https://</span>
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-semibold leading-none text-foreground">Name (optional)</span>
                <span className={cn(FIELD, "text-[15px] text-muted-foreground")}>Rehearsal track</span>
              </div>
              <span className={buttonVariants({ variant: "outline" })}>
                <Link2 className="size-5" />
                Add link
              </span>
            </div>
          </div>
        </div>
        <div>
          <span className={buttonVariants({ variant: "outline" })}>
            <Plus className="size-5" />
            Add arrangement
          </span>
        </div>
      </section>
    </SkeletonContainer>
  );
}
