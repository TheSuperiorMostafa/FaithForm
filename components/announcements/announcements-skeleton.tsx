import Link from "next/link";
import {
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import {
  buildMonthGridCells,
  formatDayAgendaHeading,
  formatMonthYear,
  getWeekdayLabels,
} from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

/**
 * Static-first announcements header:
 * Text that does not change (H1, description, Email template button)
 * loads instantly as real text without skeleton shimmer.
 */
export function AnnouncementsHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          Announcements
        </h1>
        <p className="text-sm text-muted-foreground">
          Review this week&apos;s queue, verify events, and publish to
          Facebook. Team emails roll into one Monday email draft.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/settings?tab=communications">
          <Button variant="outline">Email template</Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * Static-first weekly queue:
 * Card container, accordion trigger icon, and "Weekly email draft" heading
 * load as real elements. Only the dynamic status badge and count summary shimmer.
 */
export function WeeklyQueueSectionSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex w-full items-center gap-3 text-left">
          <ChevronDown
            className="size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-lg font-semibold text-foreground">
                Weekly email draft
              </span>
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="mt-0.5">
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Static-first calendar section:
 * Month navigation bar, weekday labels, day numbers, helper notice, and
 * inspection card structure render with real text. Skeletons only mask
 * asynchronous calendar event chips and list items.
 */
export function CalendarSectionSkeleton() {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const monthYearLabel = formatMonthYear(year, monthIndex);
  const cells = buildMonthGridCells(year, monthIndex, now);
  const dayHeading = formatDayAgendaHeading(now);

  return (
    <div className="flex flex-col gap-4">
      {/* Month navigation toolbar — real buttons and month label */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[10rem] text-center font-heading text-xl font-semibold text-foreground">
            {monthYearLabel}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled>
            Today
          </Button>
          <Button type="button" size="sm" disabled>
            <CalendarPlus className="mr-1.5 size-4" strokeWidth={1.75} />
            New event
          </Button>
        </div>
      </div>

      {/* Two-column calendar + inspector layout */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
        {/* Left column: Calendar Grid */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-card dark:shadow-none">
            {/* Weekday headers — static text */}
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

            {/* Month grid cells — real day numbers, shimmer for async events */}
            <div className="grid grid-cols-7">
              {cells.map((cell, index) => (
                <div
                  key={cell.date.toISOString()}
                  className={cn(
                    "min-h-[7rem] border-b border-r border-border p-1.5 text-left transition-all sm:min-h-[9rem] lg:min-h-[10.5rem] xl:min-h-[11rem]",
                    !cell.isCurrentMonth &&
                      "bg-[color:color-mix(in_srgb,var(--muted)_45%,transparent)]",
                    cell.isToday &&
                      "ring-2 ring-inset ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-8 items-center justify-center rounded-full text-sm font-medium",
                      cell.isToday &&
                        "bg-accent text-accent-foreground font-semibold",
                      !cell.isCurrentMonth && "text-muted-foreground",
                    )}
                  >
                    {cell.dayOfMonth}
                  </span>

                  {/* Skeletons only for asynchronous event chips */}
                  {index % 4 === 1 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      <Skeleton className="h-5 w-full rounded-md" />
                    </div>
                  )}
                  {index % 7 === 0 && (
                    <div className="mt-1.5 flex flex-col gap-1">
                      <Skeleton className="h-5 w-full rounded-md" />
                      <Skeleton className="h-5 w-4/5 rounded-md" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Static bottom helper notice */}
          <p className="text-xs text-muted-foreground">
            Select a day or event to manage its announcement, or create a new event for this month.
          </p>
        </div>

        {/* Right column: Sticky Day Inspection Card */}
        <div className="w-full scroll-mt-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader className="gap-1">
              <CardTitle>{dayHeading}</CardTitle>
              <CardDescription>
                Loading events for this day…
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-48" />
              </div>
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-40" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * Static-first published section:
 * "Submitted" label and chevron icon render normally. Only count badge shimmers.
 */
export function PublishedSectionSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-left font-heading text-lg font-semibold text-foreground/80">
        <ChevronDown className="size-5 text-muted-foreground" aria-hidden />
        <span>Submitted</span>
        <Skeleton className="h-5 w-6 rounded-full" />
      </div>
    </section>
  );
}

/**
 * Full page skeleton matching page.tsx container and layout.
 */
export function AnnouncementsPageSkeleton() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-5"
      label="announcements"
    >
      <AnnouncementsHeaderSkeleton />
      <WeeklyQueueSectionSkeleton />
      <CalendarSectionSkeleton />
      <PublishedSectionSkeleton />
    </SkeletonContainer>
  );
}
