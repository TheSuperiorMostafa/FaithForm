import { sheetDate } from "@/lib/giving/spreadsheet";

/**
 * Which year a giving statement is for.
 *
 * Year-end statements are sent in January–March for the year that just
 * ended. Defaulting to "this year" produced statements for the new, empty
 * year at exactly the moment churches send them. Until April the default is
 * last year; from April on, the year in progress.
 */
export const FIRST_STATEMENT_YEAR = 2015;

/** Fetch a one-day margin around UTC New Year, then filter in church time. */
export function statementYearReadWindow(year: number): { start: string; end: string } {
  const day = 24 * 60 * 60 * 1000;
  return {
    start: new Date(Date.UTC(year, 0, 1) - day).toISOString(),
    end: new Date(Date.UTC(year + 1, 0, 1) + day).toISOString(),
  };
}

function calendarParts(now: Date, timeZone?: string): { year: number; month: number } {
  if (!timeZone) return { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [year, month] = sheetDate(now, timeZone).split("-").map(Number);
  return { year, month };
}

export function defaultStatementYear(now: Date = new Date(), timeZone?: string): number {
  const { year, month } = calendarParts(now, timeZone);
  return month < 4 ? year - 1 : year;
}

/** A requested year, or the default when missing or out of range. */
export function parseStatementYear(
  input: string | null | undefined,
  now: Date = new Date(),
  timeZone?: string,
): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed)) return defaultStatementYear(now, timeZone);
  if (parsed < FIRST_STATEMENT_YEAR || parsed > calendarParts(now, timeZone).year) {
    return defaultStatementYear(now, timeZone);
  }
  return parsed;
}

/** Years offered in the picker, newest first. */
export function statementYearOptions(now: Date = new Date(), count = 4, timeZone?: string): number[] {
  const current = calendarParts(now, timeZone).year;
  return Array.from({ length: count }, (_, i) => current - i).filter(
    (y) => y >= FIRST_STATEMENT_YEAR,
  );
}
