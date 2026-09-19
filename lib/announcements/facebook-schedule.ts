/**
 * When an announcement's Facebook post goes out.
 *
 * Facebook schedules a Page post only if it is between ten minutes and thirty
 * days after the request that creates it. The old rule was "the day before the
 * event, at the church's post time". Whenever that slot was under ten minutes
 * away or already gone, it quietly posted immediately, and the form still
 * promised a scheduled post. That is the pilot church's "posting right away,
 * not being scheduled". Anything more than a month out failed outright.
 *
 * The form now shows the time and lets the church change it or choose to post
 * now. This module suggests the time and checks it. It is pure, using only
 * Intl, so the browser can show exactly the time the server will accept, and
 * both sides refuse with the same words.
 */

import { shiftYmd, toYMD, zonedDateTimeToUtcMs } from "@/lib/utils/dates";

/** Facebook refuses a scheduled post less than ten minutes out… */
export const FACEBOOK_MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;

/** …or more than thirty days out. */
export const FACEBOOK_MAX_SCHEDULE_LEAD_MS = 30 * 24 * 60 * 60 * 1000;

/** The Church Profile default for "Announcement Facebook post time". */
export const DEFAULT_FACEBOOK_POST_TIME = "09:00";

const FALLBACK_TIME_ZONE = "America/New_York";

/**
 * Extra time the suggestion leaves for finishing the form. Facebook counts its
 * ten minutes from the request, not from when the form opened. A suggestion
 * exactly ten minutes out would already be too soon by the time someone had
 * read the caption and pressed submit.
 */
const SUGGESTION_SLACK_MS = 10 * 60 * 1000;

/** Keeps the far end clear of the limit, so a clock running a little fast cannot push it over. */
const FAR_END_SLACK_MS = 60 * 60 * 1000;

const QUARTER_HOUR_MS = 15 * 60 * 1000;

export type FacebookPostMode = "schedule" | "now";

export type FacebookScheduleInput = {
  /** The announcement's `start_at`. Midnight UTC on its date for an all-day event. */
  startAt: string;
  allDay?: boolean;
  /** The church's IANA zone. */
  timeZone?: string | null;
  /** "HH:mm" from the Church Profile. */
  postTime?: string | null;
};

export type FacebookScheduleSuggestion = {
  /** "now" only when any valid slot would land after the event has started. */
  mode: FacebookPostMode;
  /** Inside Facebook's window at the moment it was suggested. */
  scheduledAtMs: number;
  /** Why this is not the day-before slot. The form explains it under the picker. */
  adjusted: "none" | "too-soon" | "too-far";
};

export type FacebookScheduleCheck =
  | { ok: true; scheduledAtMs: number }
  | { ok: false; error: string };

/** "HH:mm", clamped. Anything unreadable falls back to 09:00. */
export function normalizeFacebookPostTime(value: string | null | undefined): string {
  const match = (value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return DEFAULT_FACEBOOK_POST_TIME;
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** An IANA zone Intl accepts. A bad zone throws inside Intl, so this falls back instead. */
export function resolveScheduleTimeZone(timeZone: string | null | undefined): string {
  const candidate = timeZone?.trim();
  if (!candidate) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * The event's date, as the church would say it.
 *
 * An all-day event is stored as midnight UTC on its date. That instant is a
 * placeholder, not a time anyone chose. Reading it in the church's own zone put
 * every all-day event west of Greenwich on the previous day, which scheduled
 * its post two days early. The date written in the string is the right one.
 */
export function eventDateForSchedule(
  startAt: string,
  allDay: boolean,
  timeZone: string,
): string | null {
  const trimmed = startAt.trim();
  if (allDay) {
    const written = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    if (written) return written[1];
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return allDay
    ? new Date(ms).toISOString().slice(0, 10)
    : toYMD(new Date(ms), resolveScheduleTimeZone(timeZone));
}

/** The day before the event at the church's post time, in UTC milliseconds. */
export function dayBeforeFacebookSlot(input: FacebookScheduleInput): number | null {
  const timeZone = resolveScheduleTimeZone(input.timeZone);
  const eventDate = eventDateForSchedule(input.startAt, Boolean(input.allDay), timeZone);
  if (!eventDate) return null;

  return zonedDateTimeToUtcMs(
    shiftYmd(eventDate, -1),
    normalizeFacebookPostTime(input.postTime),
    timeZone,
  );
}

/** When the event begins. For an all-day event, that is local midnight on its date. */
function eventStartMs(input: FacebookScheduleInput, timeZone: string): number | null {
  if (input.allDay) {
    const date = eventDateForSchedule(input.startAt, true, timeZone);
    return date ? zonedDateTimeToUtcMs(date, "00:00", timeZone) : null;
  }
  const ms = Date.parse(input.startAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The time the form suggests for the post.
 *
 * The day-before slot when Facebook will take it. Otherwise it is pulled into
 * the window: to the next quarter hour with time to spare when the slot is too
 * close or already gone, or to the post time on the last day Facebook allows
 * when the event is more than a month away. It becomes "now" only when even
 * the soonest slot would come after the event has started.
 */
export function suggestFacebookSchedule(
  input: FacebookScheduleInput,
  now: number = Date.now(),
): FacebookScheduleSuggestion | null {
  const slot = dayBeforeFacebookSlot(input);
  if (slot === null) return null;

  const timeZone = resolveScheduleTimeZone(input.timeZone);
  const soonestComfortable = now + FACEBOOK_MIN_SCHEDULE_LEAD_MS + SUGGESTION_SLACK_MS;

  if (slot < soonestComfortable) {
    // Rounded so it reads like a time somebody picked, not 2:37 PM. Every
    // zone's UTC offset is a whole number of quarter hours, so this rounds the
    // local clock too.
    const soonest = Math.ceil(soonestComfortable / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
    const start = eventStartMs(input, timeZone);
    return {
      mode: start !== null && start <= soonest ? "now" : "schedule",
      scheduledAtMs: soonest,
      adjusted: "too-soon",
    };
  }

  const latestAllowed = now + FACEBOOK_MAX_SCHEDULE_LEAD_MS - FAR_END_SLACK_MS;
  if (slot > latestAllowed) {
    const postTime = normalizeFacebookPostTime(input.postTime);
    const lastDay = toYMD(new Date(latestAllowed), timeZone);
    let latest = zonedDateTimeToUtcMs(lastDay, postTime, timeZone);
    if (latest > latestAllowed) {
      latest = zonedDateTimeToUtcMs(shiftYmd(lastDay, -1), postTime, timeZone);
    }
    return { mode: "schedule", scheduledAtMs: latest, adjusted: "too-far" };
  }

  return { mode: "schedule", scheduledAtMs: slot, adjusted: "none" };
}

/**
 * Whether Facebook will accept this as a scheduled time, checked in UTC.
 *
 * The form checks it before sending and the server checks it again. A time that
 * fails is refused with a reason and is never quietly turned into "post now".
 */
export function checkFacebookScheduleTime(
  scheduledAt: number | string | null | undefined,
  now: number = Date.now(),
): FacebookScheduleCheck {
  const ms =
    typeof scheduledAt === "string"
      ? Date.parse(scheduledAt)
      : typeof scheduledAt === "number"
        ? scheduledAt
        : Number.NaN;

  if (!Number.isFinite(ms)) {
    return {
      ok: false,
      error: "Choose a date and time for the Facebook post, or choose Post now.",
    };
  }
  if (ms - now < FACEBOOK_MIN_SCHEDULE_LEAD_MS) {
    return {
      ok: false,
      error:
        "Facebook needs at least 10 minutes' notice to schedule a post. Pick a later time, or choose Post now.",
    };
  }
  if (ms - now > FACEBOOK_MAX_SCHEDULE_LEAD_MS) {
    return {
      ok: false,
      error:
        "Facebook can only schedule posts up to 30 days ahead. Pick an earlier time, or come back closer to the event.",
    };
  }
  return { ok: true, scheduledAtMs: ms };
}

/**
 * "Sat, Sep 26 at 9:00 AM" in the church's zone.
 *
 * Newer ICU separates "9:00" and "AM" with a narrow no-break space. That is
 * swapped for a plain space so the text is the same on every server and in
 * every browser.
 */
export function describeFacebookPostTime(ms: number, timeZone?: string | null): string {
  const zone = resolveScheduleTimeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(ms);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
  return `${day} at ${time}`.replace(/[  ]/g, " ");
}

/** "Central Daylight Time". Names the zone the picker is in when it isn't the viewer's own. */
export function describeTimeZone(ms: number, timeZone?: string | null): string {
  const zone = resolveScheduleTimeZone(timeZone);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "long" })
    .formatToParts(ms)
    .find((part) => part.type === "timeZoneName")?.value;
  return name ?? zone;
}

/** UTC milliseconds as "YYYY-MM-DDTHH:mm" on the church's clock, for the date and time inputs. */
export function toZonedInputValue(ms: number, timeZone?: string | null): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: resolveScheduleTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      // Not `hour12: false`: some engines render midnight as "24" under it.
      hourCycle: "h23",
    })
      .formatToParts(ms)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** "YYYY-MM-DDTHH:mm" on the church's clock back to UTC milliseconds, or null. */
export function fromZonedInputValue(value: string, timeZone?: string | null): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  if (!match) return null;
  const ms = zonedDateTimeToUtcMs(match[1], match[2], resolveScheduleTimeZone(timeZone));
  return Number.isFinite(ms) ? ms : null;
}
