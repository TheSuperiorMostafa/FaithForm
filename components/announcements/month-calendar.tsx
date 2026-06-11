"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { AnnouncementVerifyForm } from "@/components/announcements/announcement-verify-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import {
  addMonths,
  buildMonthGridCells,
  eventOverlapsDay,
  formatEventTime,
  formatMonthYear,
  getMonthWindow,
  getWeekdayLabels,
  startOfDay,
} from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

type MonthCalendarProps = {
  churchId: string;
  initialYear: number;
  initialMonthIndex: number;
  initialEvents: CalendarEventPreview[];
  initialPublishedByGoogleId: Record<string, string>;
  googleConnected: boolean;
  facebookConnected: boolean;
};

const MAX_CHIPS_PER_CELL = 4;

export function MonthCalendar({
  churchId,
  initialYear,
  initialMonthIndex,
  initialEvents,
  initialPublishedByGoogleId,
  googleConnected,
  facebookConnected,
}: MonthCalendarProps) {
  const [year, setYear] = useState(initialYear);
  const [monthIndex, setMonthIndex] = useState(initialMonthIndex);
  const [events, setEvents] = useState(initialEvents);
  const [publishedByGoogleId, setPublishedByGoogleId] = useState(
    initialPublishedByGoogleId,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventPreview | null>(
    () => pickAnnouncementEvent(initialEvents, initialPublishedByGoogleId),
  );

  const defaults = { googleConnected, facebookConnected };
  const today = useMemo(() => new Date(), []);

  const cells = useMemo(
    () => buildMonthGridCells(year, monthIndex, today),
    [year, monthIndex, today],
  );

  const fetchMonth = useCallback(
    async (y: number, m: number) => {
      const { startISO, endISO } = getMonthWindow(y, m);
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/announcements/calendar?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load calendar");
        }
        const nextEvents = data.events ?? [];
        const nextPublished = data.publishedByGoogleId ?? {};
        setEvents(nextEvents);
        setPublishedByGoogleId(nextPublished);
        setSelectedEvent(pickAnnouncementEvent(nextEvents, nextPublished));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load calendar");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const goToMonth = (y: number, m: number) => {
    setYear(y);
    setMonthIndex(m);
    void fetchMonth(y, m);
  };

  const goPrev = () => {
    const next = addMonths(year, monthIndex, -1);
    goToMonth(next.year, next.monthIndex);
  };

  const goNext = () => {
    const next = addMonths(year, monthIndex, 1);
    goToMonth(next.year, next.monthIndex);
  };

  const goToday = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    setSelectedDay(startOfDay(now));
    if (y !== year || m !== monthIndex) {
      goToMonth(y, m);
    }
  };

  const handleChipClick = (event: CalendarEventPreview) => {
    const isPublished = Boolean(publishedByGoogleId[event.googleEventId]);
    if (isPublished && event.htmlLink) {
      window.open(event.htmlLink, "_blank", "noopener,noreferrer");
      return;
    }
    setSelectedDay(startOfDay(new Date(event.startAt)));
    setSelectedEvent(event);
  };

  const handlePublished = (googleEventId: string) => {
    setPublishedByGoogleId((prev) => ({
      ...prev,
      [googleEventId]: prev[googleEventId] ?? "published",
    }));
  };

  const eventsForDay = (day: Date) =>
    events
      .filter((e) => eventOverlapsDay(e, day))
      .sort(
        (a, b) =>
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );

  const agendaEvents = eventsForDay(selectedDay);

  if (!googleConnected) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-6 text-accent" strokeWidth={1.75} />
            Connect Google Calendar
          </CardTitle>
          <CardDescription>
            Link Google in Settings to see your church calendar here and prefill
            announcements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/settings">
            <Button>Go to Settings</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goPrev}
            disabled={loading}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-[10rem] text-center font-heading text-xl font-semibold">
            {formatMonthYear(year, monthIndex)}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={goNext}
            disabled={loading}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          <Button type="button" variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}. Try reconnecting Google in Settings.
        </p>
      )}

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
          {cells.map((cell) => {
            const dayEvents = eventsForDay(cell.date);
            const visible = dayEvents.slice(0, MAX_CHIPS_PER_CELL);
            const overflow = dayEvents.length - visible.length;
            const isSelected =
              startOfDay(cell.date).getTime() === startOfDay(selectedDay).getTime();

            return (
              <button
                key={cell.date.toISOString()}
                type="button"
                onClick={() => setSelectedDay(startOfDay(cell.date))}
                className={cn(
                  "min-h-[6rem] border-b border-r border-border p-1.5 text-left transition-colors hover:bg-accent/5 sm:min-h-[8rem] lg:min-h-[9rem]",
                  !cell.isCurrentMonth && "bg-muted/20",
                  cell.isToday && "ring-2 ring-inset ring-accent/60",
                  isSelected && "bg-accent/10",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full text-sm",
                    cell.isToday && "bg-accent text-accent-foreground font-semibold",
                    !cell.isCurrentMonth && "text-muted-foreground",
                  )}
                >
                  {cell.dayOfMonth}
                </span>
                <div className="mt-1 flex flex-col gap-0.5">
                  {visible.map((event) => {
                    const published = Boolean(
                      publishedByGoogleId[event.googleEventId],
                    );
                    const selected =
                      selectedEvent?.googleEventId === event.googleEventId;
                    return (
                      <span
                        key={event.googleEventId}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleChipClick(event);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            handleChipClick(event);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center gap-1 truncate rounded-md px-1.5 py-1 text-xs font-semibold leading-tight sm:text-sm",
                          published
                            ? "bg-muted text-muted-foreground"
                            : "bg-accent/15 text-primary hover:bg-accent/25 dark:text-accent",
                          selected && "ring-1 ring-accent",
                        )}
                        title={`${event.title} · ${formatEventTime(event.startAt)}`}
                      >
                        {published && (
                          <Check className="size-3 shrink-0" />
                        )}
                        <span className="truncate">{event.title}</span>
                      </span>
                    );
                  })}
                  {overflow > 0 && (
                    <span className="px-1 text-xs text-muted-foreground">
                      +{overflow} more
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded bg-accent/40" />
          Needs verify
        </span>
        <span className="mx-2">·</span>
        <span className="inline-flex items-center gap-1">
          <Check className="size-3" />
          Submitted (opens in Google Calendar)
        </span>
      </p>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Announcement details</CardTitle>
          <CardDescription>
            Select a calendar event and verify the prefilled details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedEvent ? (
            <AnnouncementVerifyForm
              key={selectedEvent.googleEventId}
              churchId={churchId}
              event={selectedEvent}
              defaults={defaults}
              onPublished={() => handlePublished(selectedEvent.googleEventId)}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No Google Calendar event selected yet.
            </div>
          )}
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2 md:hidden">
        <h3 className="text-sm font-semibold">Events on selected day</h3>
        {agendaEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {agendaEvents.map((event) => {
              const published = Boolean(
                publishedByGoogleId[event.googleEventId],
              );
              return (
                <li key={event.googleEventId}>
                  <button
                    type="button"
                    onClick={() => handleChipClick(event)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-sm",
                      published
                        ? "border-border bg-muted/50"
                        : "border-accent/40 bg-accent/10",
                    )}
                  >
                    <span className="font-medium">{event.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatEventTime(event.startAt)}
                      {event.location ? ` · ${event.location}` : ""}
                      {published ? " · Submitted" : " · Tap to verify"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

    </div>
  );
}

function pickAnnouncementEvent(
  events: CalendarEventPreview[],
  publishedByGoogleId: Record<string, string>,
): CalendarEventPreview | null {
  return (
    events.find((event) => !publishedByGoogleId[event.googleEventId]) ??
    events[0] ??
    null
  );
}
