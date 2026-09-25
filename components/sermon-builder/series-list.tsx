import Link from "next/link";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { SermonSeriesListItem } from "@/lib/queries/sermons";

export function SeriesList({ series }: { series: SermonSeriesListItem[] }) {
  if (series.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No series yet"
        description="Plan several weeks of sermons around one theme. Each week gets a title and a passage to start from."
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/dashboard/sermon-builder/series/new" />}
          >
            <Plus aria-hidden className="size-5" />
            New series
          </Button>
        }
      />
    );
  }

  return (
    <ul
      aria-label="Series"
      className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm"
    >
      {series.map((s) => (
        <li key={s.id}>
          <Link
            href={`/dashboard/sermon-builder/series/${s.id}`}
            className="flex min-h-[80px] items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              <Layers className="size-6" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block truncate text-base font-semibold text-foreground">{s.title}</span>
              <span className="block truncate text-[15px] text-muted-foreground">
                {s.weeks_planned} weeks{s.theme ? ` · ${s.theme}` : ""}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
