/**
 * Which year a giving statement is for.
 *
 * Year-end statements are sent in January–March for the year that just
 * ended. Defaulting to "this year" produced statements for the new, empty
 * year at exactly the moment churches send them. Until April the default is
 * last year; from April on, the year in progress.
 */
export const FIRST_STATEMENT_YEAR = 2015;

export function defaultStatementYear(now: Date = new Date()): number {
  const year = now.getFullYear();
  return now.getMonth() < 3 ? year - 1 : year;
}

/** A requested year, or the default when missing or out of range. */
export function parseStatementYear(
  input: string | null | undefined,
  now: Date = new Date(),
): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (!Number.isFinite(parsed)) return defaultStatementYear(now);
  if (parsed < FIRST_STATEMENT_YEAR || parsed > now.getFullYear()) {
    return defaultStatementYear(now);
  }
  return parsed;
}

/** Years offered in the picker, newest first. */
export function statementYearOptions(now: Date = new Date(), count = 4): number[] {
  const current = now.getFullYear();
  return Array.from({ length: count }, (_, i) => current - i).filter(
    (y) => y >= FIRST_STATEMENT_YEAR,
  );
}
