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
import { AnnouncementSubmittedView } from "@/components/announcements/announcement-submitted-view";
import { AnnouncementVerifyForm } from "@/components/announcements/announcement-verify-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AnnouncementRow } from "@/lib/queries/announcements";
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
  initialPublishedAnnouncements: Record<string, AnnouncementRow>;
  googleConnected: boolean;
  facebookConnected: boolean;
};

const MAX_CHIPS_PER_CELL = 3;

export function MonthCalendar({
  churchId,
  initialYear,
  initialMonthIndex,
  initialEvents,
  initialPublishedByGoogleId,
  initialPublishedAnnouncements,
  googleConnected,
  facebookConnected,
}: MonthCalendarProps) {
  const [year, setYear] = useState(initialYear);
  const [monthIndex, setMonthIndex] = useState(initialMonthIndex);
  const [events, setEvents] = useState(initialEvents);
  const [publishedByGoogleId, setPublishedByGoogleId] = useState(
    initialPublishedByGoogleId,
  );
  const [publishedAnnouncements, setPublishedAnnouncements] = useState(
    initialPublishedAnnouncements,
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

  const fetchMonth = useCallback(async (y: number, m: number) => {
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
      const nextPublishedRows = data.publishedAnnouncements ?? {};
      setEvents(nextEvents);
      setPublishedByGoogleId(nextPublished);
      setPublishedAnnouncements(nextPublishedRows);
      setSelectedEvent(pickAnnouncementEvent(nextEvents, nextPublished));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

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
    setSelectedDay(startOfDay(new Date(event.startAt)));
    setSelectedEvent(event);
  };

  const handleDayClick = (day: Date) => {
    const normalized = startOfDay(day);
    setSelectedDay(normalized);
    const dayEvents = events
      .filter((e) => eventOverlapsDay(e, normalized))
      .sort(
        (a, b) =>
          new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
    if (dayEvents.length > 0) {
      const preferred =
        dayEvents.find((e) => !publishedByGoogleId[e.googleEventId]) ??
        dayEvents[0]!;
      setSelectedEvent(preferred);
    }
  };

  const handlePublished = (announcement: AnnouncementRow) => {
    if (!selectedEvent?.googleEventId) return;
    setPublishedByGoogleId((prev) => ({
      ...prev,
      [selectedEvent.googleEventId]: announcement.id,
    }));
    setPublishedAnnouncements((prev) => ({
      ...prev,
      [selectedEvent.googleEventId]: announcement,
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

  const selectedIsPublished = selectedEvent
    ? Boolean(publishedByGoogleId[selectedEvent.googleEventId])
    : false;

  const selectedAnnouncement = selectedEvent
    ? publishedAnnouncements[selectedEvent.googleEventId]
    : null;

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
              {cells.map((cell) => {
                const dayEvents = eventsForDay(cell.date);
                const visible = dayEvents.slice(0, MAX_CHIPS_PER_CELL);
                const overflow = dayEvents.length - visible.length;
                const isSelected =
                  startOfDay(cell.date).getTime() ===
                  startOfDay(selectedDay).getTime();

                return (
                  <button
                    key={cell.date.toISOString()}
                    type="button"
                    onClick={() => handleDayClick(cell.date)}
                    className={cn(
                      "min-h-[7rem] border-b border-r border-border p-1.5 text-left transition-all hover:bg-accent/10 sm:min-h-[9rem] lg:min-h-[10.5rem] xl:min-h-[11rem]",
                      !cell.isCurrentMonth && "bg-muted/20",
                      cell.isToday && !isSelected && "ring-2 ring-inset ring-accent/50",
                      isSelected &&
                        "bg-accent/30 shadow-[inset_0_0_0_2px_hsl(var(--accent))] ring-2 ring-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-8 items-center justify-center rounded-full text-sm font-medium",
                        cell.isToday && "bg-accent text-accent-foreground font-semibold",
                        isSelected && !cell.isToday && "bg-primary text-primary-foreground",
                        !cell.isCurrentMonth && "text-muted-foreground",
                      )}
                    >
                      {cell.dayOfMonth}
                    </span>
                    <div className="mt-1 flex flex-col gap-1">
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
                              "flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left leading-tight",
                              published
                                ? "bg-muted text-muted-foreground"
                                : "bg-accent/20 text-primary hover:bg-accent/30 dark:text-accent-foreground",
                              selected &&
                                "ring-2 ring-accent ring-offset-1 ring-offset-background",
                            )}
                          >
                            <span className="flex items-center gap-1">
                              {published && (
                                <Check className="size-3 shrink-0" />
                              )}
                              <span className="truncate text-[11px] font-bold tabular-nums sm:text-xs">
                                {formatEventTime(event.startAt)}
                              </span>
                            </span>
                            <span className="line-clamp-2 text-[11px] font-semibold sm:text-xs">
                              {event.title}
                            </span>
                          </span>
                        );
                      })}
                      {overflow > 0 && (
                        <span className="px-1 text-[11px] text-muted-foreground">
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
              <span className="inline-block size-2.5 rounded bg-accent/50" />
              Needs verify
            </span>
            <span className="mx-2">·</span>
            <span className="inline-flex items-center gap-1">
              <Check className="size-3" />
              Submitted — click to view details
            </span>
          </p>
        </div>

        <Card className="w-full xl:sticky xl:top-4 xl:self-start">
          <CardHeader>
            <CardTitle>Announcement details</CardTitle>
            <CardDescription>
              {selectedIsPublished
                ? "Review what was submitted for this event."
                : "Select a calendar event and verify the prefilled details."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedEvent && selectedIsPublished ? (
              selectedAnnouncement ? (
                <AnnouncementSubmittedView
                  announcement={selectedAnnouncement}
                  eventHtmlLink={selectedEvent.htmlLink}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  This event was submitted. Switch months or refresh to load saved
                  details.
                </p>
              )
            ) : selectedEvent ? (
              <AnnouncementVerifyForm
                key={selectedEvent.googleEventId}
                churchId={churchId}
                event={selectedEvent}
                defaults={defaults}
                publishedAnnouncementId={
                  publishedByGoogleId[selectedEvent.googleEventId]
                }
                onPublished={handlePublished}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Click a day or event on the calendar to get started.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-2 xl:hidden">
        <h3 className="text-sm font-semibold">Events on selected day</h3>
        {agendaEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events this day.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {agendaEvents.map((event) => {
              const published = Boolean(
                publishedByGoogleId[event.googleEventId],
              );
              const selected =
                selectedEvent?.googleEventId === event.googleEventId;
              return (
                <li key={event.googleEventId}>
                  <button
                    type="button"
                    onClick={() => handleChipClick(event)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2.5 text-left text-sm",
                      selected && "ring-2 ring-accent",
                      published
                        ? "border-border bg-muted/50"
                        : "border-accent/40 bg-accent/10",
                    )}
                  >
                    <span className="block text-sm font-bold tabular-nums text-accent">
                      {formatEventTime(event.startAt)}
                    </span>
                    <span className="font-medium">{event.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {event.location ? `${event.location} · ` : ""}
                      {published ? "Submitted — view details" : "Tap to verify"}
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
  return events.find((event) => !publishedByGoogleId[event.googleEventId]) ?? null;
}
