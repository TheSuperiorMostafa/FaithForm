/**
 * The one place start times are worked out.
 *
 * An item starts at the chosen service time plus the lengths of every earlier
 * non-header item. Headers group items: they have no time or length of their
 * own and show the subtotal of the items under them. The plan screen, the PDF
 * and share pages all call `buildTimeline`, so they cannot disagree.
 */

import type { ItemType } from "@/lib/service-plans/types";

export type TimelineInput = {
  id: string;
  itemType: ItemType;
  lengthSeconds: number;
};

export type TimelineRow = {
  id: string;
  /** Seconds after the service time this item starts; null for headers. */
  offsetSeconds: number | null;
  /** Absolute start, when a service time is known; null for headers. */
  startsAt: Date | null;
  /** For headers: the total of the items until the next header. */
  subtotalSeconds: number | null;
};

export type Timeline = {
  rows: TimelineRow[];
  byId: Map<string, TimelineRow>;
  totalSeconds: number;
};

export function buildTimeline(
  items: readonly TimelineInput[],
  serviceStartsAt: Date | string | null,
): Timeline {
  const start =
    serviceStartsAt === null
      ? null
      : serviceStartsAt instanceof Date
        ? serviceStartsAt
        : new Date(serviceStartsAt);
  const startMs = start && !Number.isNaN(start.getTime()) ? start.getTime() : null;

  const rows: TimelineRow[] = [];
  let elapsed = 0;
  let currentHeader: TimelineRow | null = null;

  for (const item of items) {
    if (item.itemType === "header") {
      currentHeader = { id: item.id, offsetSeconds: null, startsAt: null, subtotalSeconds: 0 };
      rows.push(currentHeader);
      continue;
    }
    const length = Math.max(0, Math.floor(item.lengthSeconds || 0));
    rows.push({
      id: item.id,
      offsetSeconds: elapsed,
      startsAt: startMs === null ? null : new Date(startMs + elapsed * 1000),
      subtotalSeconds: null,
    });
    elapsed += length;
    if (currentHeader) currentHeader.subtotalSeconds = (currentHeader.subtotalSeconds ?? 0) + length;
  }

  return { rows, byId: new Map(rows.map((row) => [row.id, row])), totalSeconds: elapsed };
}

/** How far over (positive) or under (negative) the target the plan runs. */
export function overTargetSeconds(totalSeconds: number, targetSeconds: number | null): number | null {
  if (!targetSeconds) return null;
  return totalSeconds - targetSeconds;
}

/**
 * Lengths as people say them: `3:00`, `45:00`, and `1:05:00` past an hour.
 * Negative input is treated as zero.
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** "5 min", "1 hr 10 min": for sentences such as "Over by 4 min". */
export function describeDuration(totalSeconds: number): string {
  const s = Math.abs(Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.round((s % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
  if (minutes > 0) return `${minutes} min`;
  return `${s} sec`;
}

/**
 * Reads what someone typed in a length field. Accepts `3` (minutes), `3:30`,
 * `1:02:03`, `90s` and `2m`. Returns null when it is not a length.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return 0;
  const unit = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(text);
  if (unit) {
    const value = Number(unit[1]);
    const u = unit[2][0];
    const seconds = u === "s" ? value : u === "m" ? value * 60 : value * 3600;
    return Math.round(seconds);
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 60);
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
}

/** "9:00 AM" in the church's own time zone. */
export function formatClockTime(at: Date | string, timeZone: string): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** "Sunday, November 23, 2026" for a `YYYY-MM-DD` calendar date. */
export function formatPlanDate(ymd: string, style: "long" | "short" = "long"): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** `HH:mm` from Postgres `time` text such as `09:00:00`. */
export function toHm(value: string): string {
  return value.slice(0, 5);
}

/** The next date on or after `fromYmd` that falls on `weekday` (0 = Sunday). */
export function nextWeekdayOnOrAfter(fromYmd: string, weekday: number): string {
  const [y, m, d] = fromYmd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a `YYYY-MM-DD` calendar date. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
