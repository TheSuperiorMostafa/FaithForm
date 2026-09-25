import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Mail,
  Megaphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import {
  buildMonthGridCells,
  formatDayAgendaHeading,
  formatMonthYear,
  getWeekdayLabels,
} from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

/**
 * Static-first skeletons for the Announcements page. Titles, descriptions and
 * buttons are real text; only what comes from the calendar or the database
 * shimmers. Every block mirrors the classes of the section it stands in for.
 */

/** The page header, exactly as the page renders it. */
export function AnnouncementsHeaderSkeleton() {
  return (
    <PageHeader
      title="Announcements"
      description="Tell your church what's happening, in the app, by email and on Facebook."
      icon={Megaphone}
      action={
        <Button size="lg" disabled>
          <Megaphone aria-hidden strokeWidth={1.75} />
          New announcement
        </Button>
      }
    />
  );
}

function RowSkeleton({ action = "w-32" }: { action?: string }) {
  return (
    <li className="flex min-h-[72px] flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Skeleton className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-48 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-16 sm:pl-0">
        <Skeleton className={cn("h-11 rounded-[10px]", action)} />
      </div>
    </li>
  );
}

/** "From your calendar (n)". */
export function CalendarSuggestionsSkeleton({
  calendarConnected = true,
}: {
  calendarConnected?: boolean;
}) {
  if (!calendarConnected) {
    return (
      <section className="flex flex-col gap-4">
        <SectionHeader title="From your calendar" />
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-border bg-card/60 p-6 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-12 w-full max-w-md rounded-2xl" />
          <Skeleton className="h-11 w-44 rounded-[10px]" />
        </div>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            From your calendar
            {/* A span, not a Skeleton div: this sits inside the heading. */}
            <span aria-hidden className="inline-block h-6 w-9 rounded-md bg-muted" />
          </span>
        }
        description="Events in the next two weeks that haven't been announced yet."
      />
      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
        <RowSkeleton />
        <RowSkeleton />
        <RowSkeleton />
      </ul>
    </section>
  );
}

/** "Posted and scheduled". */
export function PostedSectionSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Posted and scheduled"
        description="What people can see now, and what's waiting to go out."
      />
      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
        <RowSkeleton action="w-60" />
        <RowSkeleton action="w-60" />
        <RowSkeleton action="w-60" />
      </ul>
    </section>
  );
}

/** "Monday's email". */
export function WeeklyEmailCardSkeleton() {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <Mail className="size-6" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-heading text-xl font-bold text-foreground">Monday&apos;s email</h2>
          <Skeleton className="mt-1 h-5 w-52 max-w-full" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-11 w-44 rounded-[10px]" />
        <Skeleton className="h-11 w-40 rounded-[10px]" />
      </div>
      <Skeleton className="h-6 w-40" />
      <p className="w-fit text-[15px] font-semibold text-primary dark:text-accent">
        Change the email template
      </p>
    </section>
  );
}

/** "Church calendar": toolbar, weekday labels and day numbers are real. */
export function CalendarSectionSkeleton() {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const cells = buildMonthGridCells(year, monthIndex, now);

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Church calendar"
        description="Pick any day to see its events, announce one, or add a new event."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" disabled aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[10rem] text-center font-heading text-xl font-semibold text-foreground">
            {formatMonthYear(year, monthIndex)}
          </h2>
          <Button type="button" variant="outline" size="icon" disabled aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled>
            Today
          </Button>
          <Button type="button" variant="outline" disabled>
            <CalendarPlus className="size-4" strokeWidth={1.75} />
            New event
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-card dark:shadow-none">
            <div className="grid grid-cols-7 border-b border-border bg-primary text-primary-foreground dark:bg-secondary dark:text-secondary-foreground">
              {getWeekdayLabels().map((label) => (
                <div
                  key={label}
                  className="px-2 py-3 text-center font-heading text-sm font-semibold uppercase tracking-wide"
                >
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{label.slice(0, 1)}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((cell, index) => (
                <div
                  key={cell.date.toISOString()}
                  className={cn(
                    "min-h-[7rem] border-b border-r border-border p-1.5 text-left sm:min-h-[9rem] lg:min-h-[10.5rem] xl:min-h-[11rem]",
                    !cell.isCurrentMonth &&
                      "bg-[color:color-mix(in_srgb,var(--muted)_45%,transparent)]",
                    cell.isToday &&
                      "ring-2 ring-inset ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-full text-sm font-medium",
                      cell.isToday && "bg-accent font-semibold text-accent-foreground",
                      !cell.isCurrentMonth && "text-muted-foreground",
                    )}
                  >
                    {cell.dayOfMonth}
                  </span>
                  {index % 4 === 1 && (
                    <div className="mt-1 flex flex-col gap-1">
                      <Skeleton className="h-9 w-full rounded-md" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Not announced yet · Posted</p>
        </div>

        <div className="w-full xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>{formatDayAgendaHeading(now)}</CardTitle>
              <Skeleton className="h-5 w-48" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-[68px] w-full rounded-lg" />
              <Skeleton className="h-[68px] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

/** The whole page, as `loading.tsx` shows it. */
export function AnnouncementsPageSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="announcements">
      <AnnouncementsHeaderSkeleton />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-8">
          <CalendarSuggestionsSkeleton />
          <PostedSectionSkeleton />
        </div>
        <div className="flex min-w-0 flex-col gap-8 xl:sticky xl:top-4 xl:self-start">
          <WeeklyEmailCardSkeleton />
        </div>
      </div>
      <CalendarSectionSkeleton />
    </SkeletonContainer>
  );
}
