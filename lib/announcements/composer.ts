import { describeFacebookPostTime } from "@/lib/announcements/facebook-schedule";
import { publishedChannels } from "@/lib/announcements/published-channels";
import type {
  AnnouncementRow,
  MobileVisibility,
} from "@/lib/queries/announcements";

/**
 * The words the Announcements page uses, and the small pure rules behind them.
 *
 * Safe to import in the browser. The database keeps its own status values
 * (`pending`, `published`); they are mapped here and nowhere else, so the page
 * only ever says Draft · Scheduled · Posted · Taken down.
 */

export type AnnouncementState = "draft" | "scheduled" | "posted" | "taken_down";

export const ANNOUNCEMENT_STATE_LABEL: Record<AnnouncementState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  posted: "Posted",
  taken_down: "Taken down",
};

/** Matches the `StatusBadge` tones. */
export const ANNOUNCEMENT_STATE_TONE: Record<
  AnnouncementState,
  "neutral" | "working" | "done"
> = {
  draft: "neutral",
  scheduled: "working",
  posted: "done",
  taken_down: "neutral",
};

/**
 * Where an announcement is in its life, in the page's one vocabulary.
 *
 * - Not published: Taken down when someone took it down, otherwise a Draft.
 * - Published and showing somewhere people can see it now: Posted.
 * - Published but only waiting to go out (a Facebook post with a time, or a
 *   place in Monday's email): Scheduled.
 */
export function announcementState(
  row: Pick<
    AnnouncementRow,
    | "status"
    | "mobile_visibility"
    | "facebook_post_id"
    | "facebook_scheduled_publish_time"
    | "push_to_team"
  >,
  options: { takenDown?: boolean; queuedForWeeklyEmail?: boolean; now?: number } = {},
): AnnouncementState {
  if (row.status !== "published") return options.takenDown ? "taken_down" : "draft";

  const channels = publishedChannels(row as AnnouncementRow, {
    queuedForWeeklyEmail: options.queuedForWeeklyEmail,
    now: options.now,
  });

  if (channels.app.published) return "posted";
  if (channels.facebook.published && !channels.facebook.scheduledFor) return "posted";
  if (channels.facebook.published || channels.weeklyEmail.published) return "scheduled";
  return "posted";
}

/** "The FaithForm app · Facebook on Sat, Sep 26 at 9:00 AM · Monday's email" */
export function describeDestinations(
  row: AnnouncementRow,
  options: { queuedForWeeklyEmail?: boolean; timeZone?: string | null; now?: number } = {},
): string {
  const channels = publishedChannels(row, {
    queuedForWeeklyEmail: options.queuedForWeeklyEmail,
    now: options.now,
  });
  const parts: string[] = [];
  if (channels.app.published) {
    parts.push(
      channels.app.visibility === "members" ? "The FaithForm app (members)" : "The FaithForm app",
    );
  }
  if (channels.facebook.published) {
    parts.push(
      channels.facebook.scheduledFor
        ? `Facebook on ${describeFacebookPostTime(
            Date.parse(channels.facebook.scheduledFor),
            options.timeZone,
          )}`
        : "Facebook",
    );
  }
  if (channels.weeklyEmail.published) parts.push("Monday's email");
  return parts.length > 0 ? parts.join(" · ") : "Not shared anywhere yet";
}

export type PostOutcome = {
  /** It is in the FaithForm app now. */
  inApp: boolean;
  /** A notification was queued for the people who can see it. */
  notified: boolean;
  audience: MobileVisibility;
  /** The event already happened, so the app shows it only on its calendar. */
  alreadyOver?: boolean;
  queuedForWeeklyEmail?: boolean;
  facebookUrl?: string;
  facebookScheduledAt?: string;
  /** The church's zone, so a Facebook time reads on the church's clock. */
  timeZone?: string | null;
  calendarAdded?: boolean;
  /** An announcement that was already posted and has been changed. */
  updated?: boolean;
};

/**
 * One sentence per place it went, for the success screen:
 * "Posted to the FaithForm app." "Members were notified." "Added to Monday's
 * email." "Scheduled on Facebook for Sat, Sep 26 at 9:00 AM."
 */
export function describePostOutcome(outcome: PostOutcome): string[] {
  const lines: string[] = [];

  if (outcome.inApp) {
    if (outcome.alreadyOver) {
      lines.push(
        "Added to the FaithForm app's calendar. It already happened, so no one was notified.",
      );
    } else {
      lines.push(outcome.updated ? "Updated in the FaithForm app." : "Posted to the FaithForm app.");
      if (outcome.notified) {
        lines.push(
          outcome.audience === "members"
            ? "Members were notified."
            : "Everyone who follows your church was notified.",
        );
      }
    }
  }
  if (outcome.queuedForWeeklyEmail) {
    lines.push(outcome.updated ? "In Monday's email." : "Added to Monday's email.");
  }
  if (outcome.facebookScheduledAt) {
    lines.push(
      `Scheduled on Facebook for ${describeFacebookPostTime(
        Date.parse(outcome.facebookScheduledAt),
        outcome.timeZone,
      )}.`,
    );
  } else if (outcome.facebookUrl) {
    lines.push("Posted on Facebook.");
  }
  if (outcome.calendarAdded) lines.push("Added to your church calendar.");

  return lines;
}

/** "5 announcements" */
export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// The composer's unsent work, kept in this browser only.
// ---------------------------------------------------------------------------

export type ComposerDraft = {
  title: string;
  details: string;
  dated: boolean;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  audience: "followers" | "members";
  savedAt: number;
};

const DRAFT_PREFIX = "faithform:announcement-draft:";
/** A draft older than this is more likely to confuse than help. */
const DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadComposerDraft(churchId: string, now = Date.now()): ComposerDraft | null {
  try {
    const raw = storage()?.getItem(DRAFT_PREFIX + churchId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>;
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      return null;
    }
    if (!parsed.title?.trim() && !parsed.details?.trim()) return null;
    return {
      title: String(parsed.title ?? ""),
      details: String(parsed.details ?? ""),
      dated: Boolean(parsed.dated),
      date: String(parsed.date ?? ""),
      startTime: String(parsed.startTime ?? ""),
      endTime: String(parsed.endTime ?? ""),
      location: String(parsed.location ?? ""),
      audience: parsed.audience === "members" ? "members" : "followers",
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveComposerDraft(churchId: string, draft: ComposerDraft): void {
  try {
    storage()?.setItem(DRAFT_PREFIX + churchId, JSON.stringify(draft));
  } catch {
    // Private windows and full storage: the dirty-close guard still protects the work.
  }
}

export function clearComposerDraft(churchId: string): void {
  try {
    storage()?.removeItem(DRAFT_PREFIX + churchId);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------
// Dates for an announcement that is not about an event.
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" for today on the given zone's calendar (the viewer's when omitted). */
export function todayDateValue(timeZone?: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * The instants an announcement is saved with.
 *
 * - No date: today, as an all-day entry. The app lists it for about two days,
 *   the same window a date-only event gets.
 * - A date without a time: that date, all day (midnight UTC, the calendar
 *   convention every reader of `all_day` already follows).
 * - A date and a start time: that moment on the viewer's clock, and the end
 *   time when one was given.
 */
export function announcementWhen(input: {
  dated: boolean;
  date: string;
  startTime: string;
  endTime: string;
  timeZone?: string | null;
  now?: Date;
}): { startAt: string; endAt: string | null; allDay: boolean } | { error: string } {
  const date = input.dated ? input.date.trim() : todayDateValue(input.timeZone, input.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose the day it's happening." };

  const startTime = input.dated ? input.startTime.trim() : "";
  if (!startTime) {
    return { startAt: new Date(`${date}T00:00:00.000Z`).toISOString(), endAt: null, allDay: true };
  }

  const start = new Date(`${date}T${startTime}`);
  if (Number.isNaN(start.getTime())) return { error: "Choose a start time, or leave it empty." };

  const endTime = input.endTime.trim();
  if (!endTime) return { startAt: start.toISOString(), endAt: null, allDay: false };

  const end = new Date(`${date}T${endTime}`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return { error: "The end time needs to be after the start time." };
  }
  return { startAt: start.toISOString(), endAt: end.toISOString(), allDay: false };
}

// ---------------------------------------------------------------------------
// What the page hands the composer and the lists.
// ---------------------------------------------------------------------------

/** A posted (or scheduled) announcement as the page shows it. */
export type PostedItem = {
  announcement: AnnouncementRow;
  /** Not about an event: saved with no event date. */
  undated: boolean;
  /** In Monday's email through the email list rather than by posting. */
  queuedForWeeklyEmail: boolean;
  /** The calendar event it came from, when there is one. */
  calendar: { source: "google" | "apple"; readOnly: boolean } | null;
};

// ---------------------------------------------------------------------------
// Dates, the same on the server and in the browser
// ---------------------------------------------------------------------------

/**
 * Formatted with a fixed locale and the church's zone, so the server render
 * and the browser agree. A date-only entry is read in UTC, where the calendar
 * put it (see `formatDateTimeRange`).
 */
function fmt(iso: string, options: Intl.DateTimeFormatOptions, timeZone: string | null | undefined, allDay: boolean) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: allDay ? "UTC" : (timeZone ?? undefined),
    })
      .format(new Date(iso))
      .replace(/[  ]/g, " ");
  } catch {
    return new Date(iso).toDateString();
  }
}

/** "Sun, Sep 28 · 10:00 AM – 11:30 AM", "Sat, Oct 4 · All day", or "Posted Sep 25". */
export function describeWhen(
  input: {
    startAt: string;
    endAt: string | null;
    allDay: boolean;
    undated?: boolean;
    postedAt?: string | null;
  },
  timeZone?: string | null,
): string {
  if (input.undated) {
    const at = input.postedAt ?? input.startAt;
    return `Posted ${fmt(at, { month: "short", day: "numeric" }, timeZone, false)}`;
  }
  const day = fmt(input.startAt, { weekday: "short", month: "short", day: "numeric" }, timeZone, input.allDay);
  if (input.allDay) return `${day} · All day`;
  const start = fmt(input.startAt, { hour: "numeric", minute: "2-digit" }, timeZone, false);
  if (!input.endAt) return `${day} · ${start}`;
  const sameDay =
    fmt(input.endAt, { year: "numeric", month: "numeric", day: "numeric" }, timeZone, false) ===
    fmt(input.startAt, { year: "numeric", month: "numeric", day: "numeric" }, timeZone, false);
  const end = sameDay
    ? fmt(input.endAt, { hour: "numeric", minute: "2-digit" }, timeZone, false)
    : fmt(input.endAt, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, timeZone, false);
  return `${day} · ${start} – ${end}`;
}

/** The two lines of a small date tile: "SEP" and "28". */
export function dateTile(
  startAt: string,
  allDay: boolean,
  timeZone?: string | null,
): { month: string; day: string } {
  return {
    month: fmt(startAt, { month: "short" }, timeZone, allDay).toUpperCase(),
    day: fmt(startAt, { day: "numeric" }, timeZone, allDay),
  };
}
