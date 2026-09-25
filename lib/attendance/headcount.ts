/**
 * "Just a number": a Sunday counted as one headcount rather than name by name.
 *
 * Saved as an `attendance_records` row with `total_present` set and no
 * entries. Everything that reads attendance already treats the sheet's total
 * as a floor (`attendance_presence_by_date`), so the list, the Home chart and
 * the monthly report show the headcount; Follow-up has no names to offer and
 * says so.
 *
 * Pure, so the page and the server action check a number the same way.
 */
export const MAX_HEADCOUNT = 100_000;

export type HeadcountResult = { ok: true; count: number } | { ok: false; error: string };

export function parseHeadcount(value: string | number | null | undefined): HeadcountResult {
  const text = typeof value === "number" ? String(value) : (value ?? "").replace(/[,\s]/g, "");
  if (!text) return { ok: false, error: "Type how many people came." };
  if (!/^\d+$/.test(text)) return { ok: false, error: "Use a whole number, like 142." };
  const count = Number(text);
  if (count < 1) return { ok: false, error: "The number has to be at least 1." };
  if (count > MAX_HEADCOUNT) return { ok: false, error: "That number looks too big. Check it and try again." };
  return { ok: true, count };
}

/** "142 here, 38 not here": the confirm line for a by-name count. */
export function describeNameCount(present: number, absent: number): string {
  return `${present} here, ${absent} not here`;
}
