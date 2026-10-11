export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export function monthSlug(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export type ParsedMonth = {
  year: number;
  month: number;
  start: Date;
  end: Date;
  label: string;
  startDateIso: string;
  endDateIso: string;
};

export function parseMonthParam(param: string): ParsedMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(param);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (year < 1900 || year > 9998 || month < 1 || month > 12) return null;

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  return {
    year,
    month,
    start,
    end,
    label: formatMonthLabel(year, month),
    startDateIso: monthSlug(year, month) + "-01",
    endDateIso: monthSlug(end.getFullYear(), end.getMonth() + 1) + "-01",
  };
}

export function formatServiceDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/** Attendance downloads accept a month, quarter, or calendar year. */
export function parseAttendancePeriod(param: string): (ParsedMonth & { kind: "month" | "quarter" | "year" }) | null {
  const monthly = parseMonthParam(param);
  if (monthly) return { ...monthly, kind: "month" };
  const match = /^(\d{4})(?:-Q([1-4]))?$/.exec(param);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1900 || year > 9998) return null;
  const quarter = match[2] ? Number(match[2]) : null;
  const month = quarter ? (quarter - 1) * 3 + 1 : 1;
  const lastMonth = quarter ? month + 2 : 12;
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, lastMonth, 1);
  return {
    year, month: lastMonth, start, end,
    kind: quarter ? "quarter" : "year",
    label: quarter ? `Quarter ${quarter}, ${year}` : String(year),
    startDateIso: `${monthSlug(year, month)}-01`,
    endDateIso: `${monthSlug(end.getFullYear(), end.getMonth() + 1)}-01`,
  };
}

/** A calendar report becomes available at midnight after its last day. */
export function isReportPeriodComplete(period: Pick<ParsedMonth, "endDateIso">, now = new Date(), timeZone = "America/New_York"): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return period.endDateIso <= today;
}

export function formatHoursComparison(current: number, previous: number): string {
  const baseline = `${previous.toFixed(2)} hours last month`;
  if (previous === 0) return `Last month: ${baseline}. Growth percentage is unavailable with a zero baseline.`;
  const pct = ((current - previous) / previous) * 100;
  if (pct === 0) return `Unchanged from ${baseline} (0.00%).`;
  return `${pct > 0 ? "Up" : "Down"} from ${baseline} (${pct > 0 ? "+" : ""}${pct.toFixed(2)}%).`;
}
