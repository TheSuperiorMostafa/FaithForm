import Link from "next/link";
import { BookOpen, ChevronRight, Plus } from "lucide-react";
import { isSermonShared } from "@/lib/sermons/v1/share-rules";
import { sermonDisplayStatus } from "@/lib/sermon-builder/sermon-display";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SermonListItem } from "@/lib/queries/sermons";

function dateParts(date: string | null): { month: string; day: string } | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    month: parsed.toLocaleDateString(undefined, { month: "short" }),
    day: String(parsed.getDate()),
  };
}

function longDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Big rows: the date, the title, the passage and one status in the church's
 * words (Draft · In the app), never the builder's raw draft/published value.
 */
export function SermonList({
  sermons,
  sermonIdsWithSharedSlides = [],
}: {
  sermons: SermonListItem[];
  sermonIdsWithSharedSlides?: string[];
}) {
  if (sermons.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No sermons yet"
        description="Build Sunday's scripture slides in a few minutes, then present them right from here."
        action={
          <Button size="lg" nativeButton={false} render={<Link href="/dashboard/sermon-builder/new" />}>
            <Plus aria-hidden className="size-5" />
            New sermon
          </Button>
        }
      />
    );
  }

  const withSlides = new Set(sermonIdsWithSharedSlides);

  return (
    <ul
      aria-label="Sermons"
      className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm"
    >
      {sermons.map((s) => {
        const status = sermonDisplayStatus({
          notesShared: isSermonShared(s),
          slidesShared: withSlides.has(s.id),
        });
        const parts = dateParts(s.sermon_date);
        const when = longDate(s.sermon_date);
        const scripture = s.scripture_refs.filter(Boolean).join(", ");
        const context = [when, scripture || s.topic].filter(Boolean).join(" · ");

        return (
          <li key={s.id}>
            <Link
              href={`/dashboard/sermon-builder/${s.id}`}
              className="flex min-h-[80px] items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
              >
                {parts ? (
                  <>
                    <span className="text-sm font-semibold uppercase leading-none">{parts.month}</span>
                    <span className="font-heading text-xl font-bold leading-tight">{parts.day}</span>
                  </>
                ) : (
                  <BookOpen className="size-6" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block truncate text-base font-semibold text-foreground">{s.title}</span>
                {context && (
                  <span className="block truncate text-[15px] text-muted-foreground">{context}</span>
                )}
                <span className="block sm:hidden">
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </span>
              </span>
              <span className="hidden shrink-0 sm:block">
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
