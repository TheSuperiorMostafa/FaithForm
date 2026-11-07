/**
 * Recurring event occurrence generation with proper timezone handling,
 * bounded generation, and idempotency.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedInputValue } from "@/lib/announcements/facebook-schedule";

import { EVENT_REPEAT_WEEKDAYS, type EventFrequency, type EventWeekday } from "@/lib/announcements/recurrence";

export type RecurrenceFrequency = EventFrequency;

export interface RecurringEventConfig {
  churchId: string;
  announcementId: string;
  frequency: RecurrenceFrequency;
  interval?: number;
  weekdays?: readonly EventWeekday[];
  startDate: string; // YYYY-MM-DD in church timezone
  startTime: string | null; // HH:MM in church timezone, null for all-day
  endTime: string | null;
  untilDate: string; // YYYY-MM-DD in church timezone (inclusive)
  timezone: string;
  allDay: boolean;
}

interface OccurrenceDate {
  date: string; // YYYY-MM-DD
  startAt: string; // ISO 8601
  endAt: string | null; // ISO 8601
}

const MAX_OCCURRENCES = 365; // Hard limit to prevent runaway generation

/**
 * Generate occurrence dates for a recurring event.
 * Returns dates in the church's timezone, properly bounded.
 */
export function generateOccurrenceDates(config: RecurringEventConfig): OccurrenceDate[] {
  const occurrences: OccurrenceDate[] = [];
  const start = new Date(config.startDate + "T00:00:00Z");
  const until = new Date(config.untilDate + "T23:59:59Z");
  
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(until.getTime())) {
    throw new Error("Invalid start or end date");
  }
  
  if (until.getTime() < start.getTime()) {
    throw new Error("End date must be after start date");
  }
  
  // Calculate max date (5 years or until date, whichever is earlier)
  const fiveYearsOut = new Date(start);
  fiveYearsOut.setUTCFullYear(fiveYearsOut.getUTCFullYear() + 5);
  const maxDate = new Date(Math.min(until.getTime(), fiveYearsOut.getTime()));
  
  const interval = config.interval ?? 1;
  const startDay = start.getUTCDate();
  const startWeekday = start.getUTCDay();
  const weekdays = config.weekdays?.length
    ? new Set(config.weekdays)
    : new Set([EVENT_REPEAT_WEEKDAYS[startWeekday].code]);
  const current = new Date(start);

  function repeatsOn(elapsedDays: number): boolean {
    switch (config.frequency) {
      case "daily":
        return elapsedDays % interval === 0;
      case "weekly": {
        const elapsedWeeks = Math.floor((elapsedDays + startWeekday) / 7);
        return elapsedWeeks % interval === 0 && weekdays.has(EVENT_REPEAT_WEEKDAYS[current.getUTCDay()].code);
      }
      case "monthly":
      case "annually": {
        const elapsedMonths = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 +
          current.getUTCMonth() - start.getUTCMonth();
        const periodMonths = config.frequency === "annually" ? 12 * interval : interval;
        if (elapsedMonths % periodMonths !== 0) return false;

        // The existing monthly preset uses the last day of a short month.
        // Custom and annual rules skip dates that do not exist.
        const targetDay = config.frequency === "monthly" && config.interval === undefined
          ? Math.min(startDay, new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate())
          : startDay;
        return current.getUTCDate() === targetDay;
      }
    }
  }

  for (let elapsedDays = 0; current <= maxDate && occurrences.length < MAX_OCCURRENCES; elapsedDays += 1) {
    if (repeatsOn(elapsedDays)) {
      const date = current.toISOString().slice(0, 10);
      const timestamps = buildOccurrenceTimestamps(
        date,
        config.startTime,
        config.endTime,
        config.timezone,
        config.allDay,
      );
      occurrences.push({ date, ...timestamps });
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return occurrences;
}

/**
 * Build ISO 8601 timestamps for an occurrence in the church timezone.
 */
function buildOccurrenceTimestamps(
  date: string,
  startTime: string | null,
  endTime: string | null,
  timezone: string,
  allDay: boolean
): { startAt: string; endAt: string | null } {
  if (allDay) {
    // All-day events: midnight UTC on that date
    return {
      startAt: `${date}T00:00:00.000Z`,
      endAt: null,
    };
  }
  
  if (!startTime) {
    throw new Error("Start time required for non-all-day events");
  }
  
  // Convert church-local datetime to UTC
  const startAt = toUTCTimestamp(date, startTime, timezone);
  const nextDay = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const endAt = endTime ? toUTCTimestamp(endTime <= startTime ? nextDay : date, endTime, timezone) : null;
  
  return { startAt, endAt };
}

/**
 * Convert a date and time in a specific timezone to UTC ISO 8601.
 */
function toUTCTimestamp(date: string, time: string, timezone: string): string {
  const ms = fromZonedInputValue(`${date}T${time}`, timezone);
  if (ms === null) throw new Error(`Failed to convert ${date} ${time} in ${timezone} to UTC`);
  return new Date(ms).toISOString();
}

/**
 * Create occurrence records for a recurring event.
 * Idempotent: skips occurrences that already exist.
 */
export async function createRecurringOccurrences(
  config: RecurringEventConfig,
  db: SupabaseClient
): Promise<{ created: number; skipped: number; error?: string }> {
  try {
    const occurrences = generateOccurrenceDates(config);
    
    if (occurrences.length === 0) {
      return { created: 0, skipped: 0, error: "No occurrences generated" };
    }
    
    // Check which occurrences already exist
    const { data: existing, error: readError } = await db
      .from("announcement_occurrences")
      .select("occurrence_date")
      .eq("announcement_id", config.announcementId)
      .eq("church_id", config.churchId);
    if (readError) return { created: 0, skipped: 0, error: readError.message };
    
    const existingDates = new Set((existing || []).map((row) => row.occurrence_date));
    
    // Insert only new occurrences
    const toCreate = occurrences
      .filter((occ) => !existingDates.has(occ.date))
      .map((occ) => ({
        church_id: config.churchId,
        announcement_id: config.announcementId,
        occurrence_date: occ.date,
        start_at: occ.startAt,
        end_at: occ.endAt,
        all_day: config.allDay,
        status: "active",
      }));
    
    if (toCreate.length === 0) {
      return { created: 0, skipped: occurrences.length };
    }
    
    const { error } = await db.from("announcement_occurrences").insert(toCreate);
    
    if (error) {
      console.error("[recurring-events] Failed to create occurrences:", error);
      return { created: 0, skipped: 0, error: error.message };
    }
    
    return {
      created: toCreate.length,
      skipped: occurrences.length - toCreate.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[recurring-events] Generation failed:", msg);
    return { created: 0, skipped: 0, error: msg };
  }
}

/**
 * Cancel a specific occurrence of a recurring event.
 */
export async function cancelOccurrence(
  occurrenceId: string,
  userId: string,
  reason: string | null,
  db: SupabaseClient
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("announcement_occurrences")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: userId,
      cancellation_reason: reason,
    })
    .eq("id", occurrenceId)
    .eq("status", "active");
  
  if (error) {
    return { ok: false, error: error.message };
  }
  
  return { ok: true };
}

/**
 * Edit a specific occurrence (override parent event details).
 */
export async function editOccurrence(
  occurrenceId: string,
  overrides: {
    title?: string | null;
    description?: string | null;
    location?: string | null;
    startAt?: string;
    endAt?: string | null;
  },
  db: SupabaseClient
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("announcement_occurrences")
    .update({
      title: overrides.title || null,
      description: overrides.description || null,
      event_location: overrides.location || null,
      start_at: overrides.startAt,
      end_at: overrides.endAt,
    })
    .eq("id", occurrenceId)
    .eq("status", "active");
  
  if (error) {
    return { ok: false, error: error.message };
  }
  
  return { ok: true };
}
