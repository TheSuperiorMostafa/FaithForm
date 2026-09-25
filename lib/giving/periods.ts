/**
 * The date ranges Giving talks about: this week, this month, this year.
 *
 * A church week starts on Sunday, so "This week" always includes the most
 * recent Sunday's offering. Dates are the calendar dates a person picks
 * (`YYYY-MM-DD`), which is also what the gifts page puts in its URL.
 */

export function startOfWeek(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function startOfMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function startOfYear(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), 0, 1);
}

/** `YYYY-MM-DD` in local time (not UTC, which would shift the day). */
export function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type RangePreset = "week" | "month" | "year";

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

export function rangeForPreset(
  preset: RangePreset,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const from =
    preset === "week" ? startOfWeek(now) : preset === "month" ? startOfMonth(now) : startOfYear(now);
  return { dateFrom: toDateInput(from), dateTo: toDateInput(now) };
}

/**
 * Which chip is lit for the dates in the URL: a preset when the dates match
 * one exactly, "custom" for any other dates, and null for no dates at all.
 */
export function detectRangePreset(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  now: Date = new Date(),
): RangePreset | "custom" | null {
  if (!dateFrom && !dateTo) return null;
  for (const { value } of RANGE_PRESETS) {
    const range = rangeForPreset(value, now);
    if (range.dateFrom === dateFrom && range.dateTo === dateTo) return value;
  }
  return "custom";
}
