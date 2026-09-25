"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, Megaphone } from "lucide-react";

import { useAnnouncementComposer } from "@/components/announcements/composer-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page-header";
import { dateTile, describeWhen } from "@/lib/announcements/composer";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

/** Enough to scan at a glance; the rest is one click away. */
const FIRST_SHOWN = 4;

export type CalendarSuggestion = CalendarEventPreview & { announcementId?: string };

/**
 * "From your calendar": events coming up that nobody has announced yet, each
 * with one big "Announce" that opens the composer already filled in. For
 * churches that live in their calendar this is the fastest way to post.
 */
export function CalendarSuggestions({
  events,
  calendarConnected,
  calendarProblem,
  timeZone,
}: {
  events: CalendarSuggestion[];
  calendarConnected: boolean;
  /** Some of the calendar couldn't be read. */
  calendarProblem: boolean;
  timeZone: string | null;
}) {
  const { openComposer } = useAnnouncementComposer();
  const [showAll, setShowAll] = useState(false);

  if (!calendarConnected) {
    return (
      <section aria-labelledby="from-calendar-heading" className="flex flex-col gap-4">
        <SectionHeader id="from-calendar-heading" title="From your calendar" />
        <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-border bg-card/60 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              <CalendarDays className="size-6" strokeWidth={1.5} />
            </span>
            <p className="text-[15px] text-muted-foreground">
              Connect your Google or iCloud calendar and your events show up here,
              ready to announce with one click.
            </p>
          </div>
          <Link
            href="/dashboard/settings?tab=accounts"
            className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}
          >
            Connect a calendar
          </Link>
        </div>
      </section>
    );
  }

  const shown = showAll ? events : events.slice(0, FIRST_SHOWN);

  return (
    <section aria-labelledby="from-calendar-heading" className="flex flex-col gap-4">
      <SectionHeader
        id="from-calendar-heading"
        title={`From your calendar (${events.length})`}
        description="Events in the next two weeks that haven't been announced yet."
      />

      {calendarProblem && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          Some of your calendar couldn&apos;t be read just now. If this keeps happening,{" "}
          <Link
            href="/dashboard/settings?tab=accounts"
            className="font-semibold underline underline-offset-2"
          >
            reconnect it in Settings
          </Link>
          .
        </p>
      )}

      {events.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-6 py-6 text-[15px] text-muted-foreground">
          You&apos;re all caught up. Nothing on your calendar in the next two weeks
          still needs announcing.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {shown.map((event) => {
            const tile = dateTile(event.startAt, Boolean(event.allDay), timeZone);
            return (
              <li
                key={event.googleEventId}
                className="flex min-h-[72px] flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <span
                    aria-hidden
                    className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl bg-primary/[0.07] leading-none text-primary dark:bg-accent/15 dark:text-accent"
                  >
                    <span className="text-xs font-bold tracking-wide">{tile.month}</span>
                    <span className="mt-0.5 font-heading text-lg font-bold">{tile.day}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-foreground">{event.title}</p>
                    <p className="mt-0.5 text-[15px] text-muted-foreground">
                      {describeWhen(
                        {
                          startAt: event.startAt,
                          endAt: event.endAt,
                          allDay: Boolean(event.allDay),
                        },
                        timeZone,
                      )}
                      {event.location ? ` · ${event.location}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 pl-16 sm:pl-0">
                  <Button
                    variant="outline"
                    onClick={() =>
                      openComposer({
                        kind: "calendar",
                        event,
                        announcementId: event.announcementId ?? null,
                      })
                    }
                    aria-label={`Announce ${event.title}`}
                  >
                    <Megaphone aria-hidden strokeWidth={1.75} />
                    Announce
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {events.length > FIRST_SHOWN && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
          className="flex min-h-11 w-fit items-center gap-2 rounded-lg px-1 text-[15px] font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-5 text-muted-foreground transition-transform motion-reduce:transition-none",
              showAll && "rotate-180",
            )}
          />
          {showAll ? "Show fewer" : `Show all ${events.length}`}
        </button>
      )}
    </section>
  );
}
