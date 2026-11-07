/**
 * Recurring event occurrence generation with proper timezone handling,
 * bounded generation, and idempotency.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedInputValue } from "@/lib/announcements/facebook-schedule";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurringEventConfig {
  churchId: string;
  announcementId: string;
  frequency: RecurrenceFrequency;
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
  
  const current = new Date(start);
  let count = 0;
  
  while (current.getTime() <= maxDate.getTime() && count < MAX_OCCURRENCES) {
    const dateStr = current.toISOString().split("T")[0];
    
    // Build proper ISO timestamps in the church timezone
    const { startAt, endAt } = buildOccurrenceTimestamps(
      dateStr,
      config.startTime,
      config.endTime,
      config.timezone,
      config.allDay
    );
    
    occurrences.push({ date: dateStr, startAt, endAt });
    
    // Advance to next occurrence
    switch (config.frequency) {
      case "daily":
        current.setUTCDate(current.getUTCDate() + 1);
        break;
      case "weekly":
        current.setUTCDate(current.getUTCDate() + 7);
        break;
      case "monthly":
        // Keep same day of month, handle month-end edge cases
        const targetDay = start.getUTCDate();
        current.setUTCDate(1); // Set to 1st first to avoid skipping months
        current.setUTCMonth(current.getUTCMonth() + 1);
        // If target day doesn't exist in new month (e.g., Jan 31 -> Feb 31), use last day
        const lastDayOfMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
        current.setUTCDate(Math.min(targetDay, lastDayOfMonth));
        break;
    }
    
    count++;
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
