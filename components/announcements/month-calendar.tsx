"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Radio,
  Users,
} from "lucide-react";
import { AnnouncementSubmittedView } from "@/components/announcements/announcement-submitted-view";
import { AnnouncementVerifyForm } from "@/components/announcements/announcement-verify-form";
import { CreateEventDialog } from "@/components/announcements/create-event-dialog";
import { DeleteEventButton } from "@/components/announcements/delete-event-button";
import {
  EventAttendanceEditor,
  type EventAttendanceCampus,
} from "@/components/announcements/event-attendance-editor";
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
import type { AttendanceSetupPolicy } from "@/lib/attendance/v2/setup";
import type { EventAttendanceSettings } from "@/lib/attendance/v2/event-attendance-types";
import {
  addMonths,
  buildMonthGridCells,
  eventOverlapsDay,
  eventStartDay,
  formatDayAgendaHeading,
  formatEventStart,
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
  /** Events put in this week's email from the weekly queue. */
  initialEmailQueuedEventIds?: string[];
  /** Any calendar at all — Google, iCloud, or both. */
  calendarConnected: boolean;
  /** False when the only calendar is a read-only iCloud link. */
  canCreateEvents: boolean;
  /** Google specifically: the weekly email is a Gmail draft. */
  googleConnected: boolean;
  /**
   * Whether this church can make the weekly email at all — through Gmail or
   * iCloud Mail. Falls back to `googleConnected` when not given.
   */
  emailAvailable?: boolean;
  facebookConnected: boolean;
  initialAttendanceByEventId: Record<string, EventAttendanceSettings>;
  attendanceCampuses: EventAttendanceCampus[];
  attendancePolicy: AttendanceSetupPolicy;
  isAdmin: boolean;
};

const MAX_CHIPS_PER_CELL = 4;

/*
 * Tints of the church's accent. Theme colours are plain `var(--accent)` hex
 * values, and Tailwind 3 cannot put an opacity modifier on those: `bg-accent/15`
 * compiles to nothing, which is why the selected day used to show no highlight
 * at all. `color-mix` does the same job for real.
 */
const NEEDS_VERIFY_TINT =
  "border-[color:color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)] text-foreground";
const NEEDS_VERIFY_HOVER =
  "hover:bg-[color:color-mix(in_srgb,var(--accent)_25%,transparent)]";
const SUBMITTED_TINT = "border-border bg-secondary text-secondary-foreground";

function eventChipClassName(opts: {
  published: boolean;
  selected: boolean;
}): string {
  const { published, selected } = opts;
  return cn(
    "flex w-full flex-col gap-0.5 rounded-md border px-1.5 py-1 text-left leading-tight transition-colors",
    published ? SUBMITTED_TINT : cn(NEEDS_VERIFY_TINT, NEEDS_VERIFY_HOVER),
    selected &&
      "ring-2 ring-accent ring-offset-1 ring-offset-background shadow-sm",
  );
}

/** The day the calendar lands on for a month: today in this month, else the 1st. */
function defaultDayForMonth(year: number, monthIndex: number): Date {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === monthIndex
    ? startOfDay(now)
    : new Date(year, monthIndex, 1);
}

/**
 * The month grid and the announcement panel beside it are one control: the
 * panel always describes the selected day. Clicking a day lists that day's
 * events (or offers to create one); clicking an event opens it. Nothing from a
 * previously selected day can stay on screen, because the open event is looked
 * up among the selected day's events rather than kept as its own copy.
 */
export function MonthCalendar({
  churchId,
  initialYear,
  initialMonthIndex,
  initialEvents,
  initialPublishedByGoogleId,
  initialPublishedAnnouncements,
  initialEmailQueuedEventIds,
  calendarConnected,
  canCreateEvents,
  googleConnected,
  emailAvailable,
  facebookConnected,
  initialAttendanceByEventId,
  attendanceCampuses,
  attendancePolicy,
  isAdmin,
}: MonthCalendarProps) {
  const router = useRouter();
  const [year, setYear] = useState(initialYear);
  const [monthIndex, setMonthIndex] = useState(initialMonthIndex);
  const [events, setEvents] = useState(initialEvents);
  const [publishedByGoogleId, setPublishedByGoogleId] = useState(
    initialPublishedByGoogleId,
  );
  const [publishedAnnouncements, setPublishedAnnouncements] = useState(
    initialPublishedAnnouncements,
  );
  const [attendanceByEventId, setAttendanceByEventId] = useState(
    initialAttendanceByEventId,
  );
  const [emailQueuedIds, setEmailQueuedIds] = useState(
    () => new Set(initialEmailQueuedEventIds ?? []),
  );
  /** The published event whose "publish somewhere else" form is open. */
  const [addingChannelsFor, setAddingChannelsFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shownMonth = useRef({ year: initialYear, monthIndex: initialMonthIndex });
  shownMonth.current = { year, monthIndex };

  // The weekly queue above publishes too, then refreshes the page. Take the
  // fresh submitted state, and the fresh events when this month is still the
  // one on screen, so a publish there shows up here without a reload.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setPublishedByGoogleId(initialPublishedByGoogleId);
    setPublishedAnnouncements(initialPublishedAnnouncements);
    setEmailQueuedIds(new Set(initialEmailQueuedEventIds ?? []));
    if (
      shownMonth.current.year === initialYear &&
      shownMonth.current.monthIndex === initialMonthIndex
    ) {
      setEvents(initialEvents);
    }
  }, [
    initialEvents,
    initialPublishedByGoogleId,
    initialPublishedAnnouncements,
    initialEmailQueuedEventIds,
    initialYear,
    initialMonthIndex,
  ]);

  const defaults = {
    googleConnected,
    facebookConnected,
    emailAvailable: emailAvailable ?? googleConnected,
  };
  const today = useMemo(() => new Date(), []);

  const cells = useMemo(
    () => buildMonthGridCells(year, monthIndex, today),
    [year, monthIndex, today],
  );

  const eventsForDay = useCallback(
    (day: Date) =>
      events
        .filter((e) => eventOverlapsDay(e, day))
        .sort((a, b) => {
          // All-day events first, then by start time.
          if (Boolean(a.allDay) !== Boolean(b.allDay)) return a.allDay ? -1 : 1;
          return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
        }),
    [events],
  );

  const dayEvents = eventsForDay(selectedDay);
  const selectedEvent = selectedEventId
    ? (dayEvents.find((e) => e.googleEventId === selectedEventId) ?? null)
    : null;

  const fetchMonth = useCallback(
    async (y: number, m: number, preferredGoogleId?: string) => {
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
        const nextEvents: CalendarEventPreview[] = data.events ?? [];
        setEvents(nextEvents);
        setPublishedByGoogleId(data.publishedByGoogleId ?? {});
        setPublishedAnnouncements(data.publishedAnnouncements ?? {});
        setAttendanceByEventId(data.attendanceByEventId ?? {});
        setEmailQueuedIds(new Set(data.emailQueuedEventIds ?? []));
        if (preferredGoogleId) {
          const preferred = nextEvents.find(
            (e) => e.googleEventId === preferredGoogleId,
          );
          if (preferred) {
            setSelectedDay(eventStartDay(preferred));
            setSelectedEventId(preferred.googleEventId);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load calendar");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const goToMonth = (y: number, m: number, day?: Date) => {
    setYear(y);
    setMonthIndex(m);
    setSelectedDay(day ?? defaultDayForMonth(y, m));
    setSelectedEventId(null);
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
    if (y !== year || m !== monthIndex) {
      goToMonth(y, m, startOfDay(now));
      return;
    }
    setSelectedDay(startOfDay(now));
    setSelectedEventId(null);
  };

  /** On small screens the panel sits under the grid; bring it into view. */
  const revealPanel = () => {
    const panel = panelRef.current;
    if (!panel || typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1280px)").matches) return;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDayClick = (day: Date) => {
    setSelectedDay(startOfDay(day));
    setSelectedEventId(null);
    revealPanel();
  };

  /** A chip opens its event on the day it was clicked, even mid-way through a multi-day event. */
  const handleChipClick = (event: CalendarEventPreview, day: Date) => {
    setSelectedDay(startOfDay(day));
    setSelectedEventId(event.googleEventId);
    revealPanel();
  };

  const handlePublished = (announcement: AnnouncementRow) => {
    if (!selectedEvent?.googleEventId) return;

    // Prefer the Google event id from the submitted announcement when present.
    const eventId = announcement.google_event_id ?? selectedEvent.googleEventId;

    const updatedEvent: CalendarEventPreview = {
      ...selectedEvent,
      googleEventId: eventId,
      title: announcement.title,
      location: announcement.event_location ?? "",
      startAt: announcement.start_at,
      endAt: announcement.end_at,
    };

    setPublishedByGoogleId((prev) => ({
      ...prev,
      [eventId]: announcement.id,
    }));
    setPublishedAnnouncements((prev) => ({
      ...prev,
      [eventId]: announcement,
    }));

    // Immediately reflect edits on the month grid (title, day, time).
    setEvents((prev) => {
      const without = prev.filter((e) => e.googleEventId !== eventId);
      return [...without, updatedEvent];
    });

    const eventDay = eventStartDay(updatedEvent);
    setSelectedDay(eventDay);
    setSelectedEventId(eventId);

    const y = eventDay.getFullYear();
    const m = eventDay.getMonth();
    if (y !== year || m !== monthIndex) {
      setYear(y);
      setMonthIndex(m);
    }
    // Refetch so calendar patches (and published maps) stay in sync, and
    // refresh the page so the weekly queue above picks up the change.
    void fetchMonth(y, m, eventId);
    router.refresh();
  };

  const handleChannelsAdded = (announcement: AnnouncementRow) => {
    setAddingChannelsFor(null);
    handlePublished(announcement);
  };

  /** Back to "needs verify" at once; the refresh the dialog starts confirms it. */
  const handleUnsubmitted = (eventId: string) => {
    const without = <T,>(record: Record<string, T>) => {
      const next = { ...record };
      delete next[eventId];
      return next;
    };
    setPublishedByGoogleId(without);
    setPublishedAnnouncements(without);
    setAddingChannelsFor(null);
  };

  /** Takes a deleted event off the grid at once; the refresh confirms it. */
  const handleEventDeleted = (eventId: string) => {
    const without = <T,>(record: Record<string, T>) => {
      const next = { ...record };
      delete next[eventId];
      return next;
    };
    setEvents((prev) => prev.filter((e) => e.googleEventId !== eventId));
    setPublishedByGoogleId(without);
    setPublishedAnnouncements(without);
    setAttendanceByEventId(without);
    setSelectedEventId(null);
    setAddingChannelsFor(null);
    router.refresh();
  };

  const handleEventCreated = (
    event: CalendarEventPreview,
    attendance?: EventAttendanceSettings | null,
  ) => {
    const eventDay = eventStartDay(event);
    const y = eventDay.getFullYear();
    const m = eventDay.getMonth();
    setSelectedDay(eventDay);

    if (y !== year || m !== monthIndex) {
      setYear(y);
      setMonthIndex(m);
      void fetchMonth(y, m, event.googleEventId);
      return;
    }

    setEvents((prev) =>
      prev.some((e) => e.googleEventId === event.googleEventId)
        ? prev
        : [...prev, event],
    );
    setSelectedEventId(event.googleEventId);
    if (attendance) {
      setAttendanceByEventId((previous) => ({
        ...previous,
        [event.googleEventId]: attendance,
      }));
    }
  };

  const selectedIsPublished = selectedEvent
    ? Boolean(publishedByGoogleId[selectedEvent.googleEventId])
    : false;

  const selectedAnnouncement = selectedEvent
    ? publishedAnnouncements[selectedEvent.googleEventId]
    : null;

  const dayHeading = formatDayAgendaHeading(selectedDay);

  if (!calendarConnected) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-6 text-accent" strokeWidth={1.75} />
            Connect a calendar
          </CardTitle>
          <CardDescription>
            Link Google Calendar or iCloud Calendar in Settings to see your
            church calendar here and prefill announcements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard/settings?tab=integrations">
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
          {canCreateEvents && (
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              <CalendarPlus className="size-4" strokeWidth={1.75} />
              New event
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error.replace(/[.!?]$/, "")}. Check the calendar connection in
          Settings.
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
                const cellEvents = eventsForDay(cell.date);
                const visible = cellEvents.slice(0, MAX_CHIPS_PER_CELL);
                const overflow = cellEvents.length - visible.length;
                const isSelected =
                  startOfDay(cell.date).getTime() ===
                  startOfDay(selectedDay).getTime();

                return (
                  <button
                    key={cell.date.toISOString()}
                    type="button"
                    onClick={() => handleDayClick(cell.date)}
                    aria-pressed={isSelected}
                    aria-label={`${formatDayAgendaHeading(cell.date)}, ${
                      cellEvents.length === 0
                        ? "no events"
                        : `${cellEvents.length} event${cellEvents.length === 1 ? "" : "s"}`
                    }`}
                    className={cn(
                      "min-h-[7rem] border-b border-r border-border p-1.5 text-left transition-all sm:min-h-[9rem] lg:min-h-[10.5rem] xl:min-h-[11rem]",
                      !isSelected &&
                        "hover:bg-[color:color-mix(in_srgb,var(--accent)_10%,transparent)]",
                      !cell.isCurrentMonth &&
                        "bg-[color:color-mix(in_srgb,var(--muted)_45%,transparent)]",
                      cell.isToday &&
                        !isSelected &&
                        "ring-2 ring-inset ring-[color:color-mix(in_srgb,var(--accent)_55%,transparent)]",
                      isSelected &&
                        "bg-[color:color-mix(in_srgb,var(--accent)_22%,transparent)] ring-2 ring-inset ring-accent",
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
                        const attendance = attendanceByEventId[event.googleEventId];
                        const selected =
                          isSelected &&
                          selectedEvent?.googleEventId === event.googleEventId;
                        return (
                          <span
                            key={event.googleEventId}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChipClick(event, cell.date);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                handleChipClick(event, cell.date);
                              }
                            }}
                            className={eventChipClassName({ published, selected })}
                          >
                            <span className="flex items-center gap-1">
                              {published && (
                                <Check className="size-3 shrink-0 text-accent" />
                              )}
                              {attendance?.enabled && (
                                attendance.automaticEnabled ? (
                                  <Radio className="size-2.5 shrink-0 text-accent" />
                                ) : (
                                  <Users className="size-2.5 shrink-0 text-accent/80" />
                                )
                              )}
                              <span
                                className={cn(
                                  "truncate text-[11px] font-bold tabular-nums sm:text-xs",
                                  !published && "text-accent",
                                )}
                              >
                                {formatEventStart(event)}
                              </span>
                            </span>
                            <span className="line-clamp-2 text-[11px] font-semibold text-foreground sm:text-xs">
                              {event.title}
                            </span>
                          </span>
                        );
                      })}
                      {overflow > 0 && (
                        <span className="rounded px-1 text-[11px] font-semibold text-accent">
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
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded border", NEEDS_VERIFY_TINT)} />
              Needs verify
            </span>
            <span className="mx-2">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded border", SUBMITTED_TINT)} />
              <Check className="size-3 text-accent" />
              Submitted
            </span>
          </p>
        </div>

        <div ref={panelRef} className="w-full scroll-mt-4 xl:sticky xl:top-4 xl:self-start">
          <Card>
            {selectedEvent ? (
              <>
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedEventId(null)}
                      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="size-4" />
                      {dayEvents.length > 1
                        ? `All ${dayEvents.length} events on ${dayHeading}`
                        : `Back to ${dayHeading}`}
                    </button>
                    {isAdmin && (
                      <DeleteEventButton
                        key={selectedEvent.googleEventId}
                        event={selectedEvent}
                        announcement={selectedAnnouncement}
                        queuedForWeeklyEmail={emailQueuedIds.has(
                          selectedEvent.googleEventId,
                        )}
                        attendance={attendanceByEventId[selectedEvent.googleEventId]}
                        onDeleted={handleEventDeleted}
                      />
                    )}
                  </div>
                  <CardTitle>Announcement details</CardTitle>
                  <CardDescription>
                    {selectedIsPublished
                      ? "See where this event is published, or publish it somewhere else."
                      : "Verify the prefilled details, then publish."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedIsPublished ? (
                    selectedAnnouncement ? (
                      addingChannelsFor === selectedEvent.googleEventId ? (
                        <AnnouncementVerifyForm
                          key={`add-${selectedEvent.googleEventId}`}
                          churchId={churchId}
                          event={selectedEvent}
                          defaults={defaults}
                          publishedAnnouncementId={selectedAnnouncement.id}
                          addChannelsTo={selectedAnnouncement}
                          queuedForWeeklyEmail={emailQueuedIds.has(
                            selectedEvent.googleEventId,
                          )}
                          onPublished={handleChannelsAdded}
                          onCancel={() => setAddingChannelsFor(null)}
                        />
                      ) : (
                        <AnnouncementSubmittedView
                          announcement={selectedAnnouncement}
                          eventHtmlLink={selectedEvent.htmlLink}
                          calendarSource={selectedEvent.source}
                          queuedForWeeklyEmail={emailQueuedIds.has(
                            selectedEvent.googleEventId,
                          )}
                          isAdmin={isAdmin}
                          onPublishMore={() =>
                            setAddingChannelsFor(selectedEvent.googleEventId)
                          }
                          onUnsubmitted={() =>
                            handleUnsubmitted(selectedEvent.googleEventId)
                          }
                        />
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        This event was submitted. Switch months or refresh to
                        load saved details.
                      </p>
                    )
                  ) : (
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
                  )}
                  <EventAttendanceEditor
                    event={selectedEvent}
                    campuses={attendanceCampuses}
                    policy={attendancePolicy}
                    initial={attendanceByEventId[selectedEvent.googleEventId]}
                    canEdit={isAdmin}
                    onSaved={(settings) =>
                      setAttendanceByEventId((previous) => ({
                        ...previous,
                        [selectedEvent.googleEventId]: settings,
                      }))
                    }
                  />
                </CardContent>
              </>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>{dayHeading}</CardTitle>
                  <CardDescription>
                    {dayEvents.length === 0
                      ? "Nothing on the calendar this day."
                      : dayEvents.length === 1
                        ? "1 event this day. Choose it to announce it."
                        : `${dayEvents.length} events this day. Choose one to announce it.`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {dayEvents.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      <ul className="flex flex-col gap-2">
                        {dayEvents.map((event) => {
                          const published = Boolean(
                            publishedByGoogleId[event.googleEventId],
                          );
                          const attendance = attendanceByEventId[event.googleEventId];
                          return (
                            <li key={event.googleEventId}>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedEventId(event.googleEventId)
                                }
                                className={cn(
                                  "group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                  published
                                    ? cn(SUBMITTED_TINT, "hover:brightness-95")
                                    : cn(NEEDS_VERIFY_TINT, NEEDS_VERIFY_HOVER),
                                )}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    {published && (
                                      <Check className="size-3.5 shrink-0 text-accent" />
                                    )}
                                    <span className="text-sm font-bold tabular-nums text-accent">
                                      {formatEventStart(event)}
                                    </span>
                                    {attendance?.enabled && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                                        {attendance.automaticEnabled ? (
                                          <>
                                            <Radio className="size-3" />
                                            <span>Auto attendance</span>
                                          </>
                                        ) : (
                                          <>
                                            <Users className="size-3" />
                                            <span>Attendance</span>
                                          </>
                                        )}
                                      </span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block font-semibold text-foreground">
                                    {event.title}
                                  </span>
                                  {event.location ? (
                                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                      <MapPin className="size-3 shrink-0" />
                                      <span className="truncate">{event.location}</span>
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 self-center text-xs font-medium text-muted-foreground group-hover:text-foreground">
                                  {published ? "View" : "Verify"}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {canCreateEvents && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="self-start"
                          onClick={() => setCreateOpen(true)}
                        >
                          <CalendarPlus className="size-4" strokeWidth={1.75} />
                          Add another event this day
                        </Button>
                      )}
                    </div>
                  ) : canCreateEvents ? (
                    <button
                      type="button"
                      onClick={() => setCreateOpen(true)}
                      className="flex w-full flex-col items-center gap-3 rounded-xl border border-dashed border-border px-4 py-10 text-center transition-colors hover:border-accent hover:bg-[color:color-mix(in_srgb,var(--accent)_6%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <CalendarPlus
                        className="size-6 text-accent"
                        strokeWidth={1.75}
                      />
                      <span className="text-sm font-semibold text-foreground">
                        Create a new event for this day.
                      </span>
                    </button>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                      Nothing on this day. Add an event in Apple Calendar and
                      it will show up here within a few minutes.
                    </p>
                  )}
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>

      <CreateEventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={selectedDay}
        attendanceCampuses={attendanceCampuses}
        attendancePolicy={attendancePolicy}
        onCreated={handleEventCreated}
      />
    </div>
  );
}
