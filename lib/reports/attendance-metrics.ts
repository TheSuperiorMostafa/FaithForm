export type AttendanceWeekRow = {
  dateLabel: string;
  serviceDate: string;
  sundaySchool: number | null;
  morningWorship: number | null;
};

export type AttendanceComparisonMetrics = {
  monthlyAverage: number | null;
  ytdAverage: number | null;
  currentSixMonthAverage: number | null;
  prevMonthAverage: number | null;
  priorYtdAverage: number | null;
  previousSixMonthAverage: number | null;
  monthToMonthGrowthPct: number | null;
  ytdGrowthPct: number | null;
  sixMonthChangePct: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

function growthPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseServiceDate(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function withinRange(
  iso: string,
  start: { year: number; month: number; day?: number },
  endExclusive: { year: number; month: number; day?: number },
): boolean {
  const d = parseServiceDate(iso);
  if (!d) return false;
  const startDay = start.day ?? 1;
  const endDay = endExclusive.day ?? 1;
  const startNum = start.year * 10000 + start.month * 100 + startDay;
  const endNum =
    endExclusive.year * 10000 + endExclusive.month * 100 + endDay;
  const cur = d.year * 10000 + d.month * 100 + d.day;
  return cur >= startNum && cur < endNum;
}

function shiftMonth(year: number, month: number, delta: number): {
  year: number;
  month: number;
} {
  const idx = year * 12 + (month - 1) + delta;
  return {
    year: Math.floor(idx / 12),
    month: (idx % 12) + 1,
  };
}

/**
 * Build classic attendance comparison metrics from morning-worship counts.
 * Expects rows with ISO service_date and numeric morningWorship values.
 */
export function buildAttendanceComparisonMetrics(
  rows: { serviceDate: string; morningWorship: number | null }[],
  year: number,
  month: number,
): AttendanceComparisonMetrics {
  const worshipByDate = rows
    .filter((r) => r.morningWorship != null && r.morningWorship > 0)
    .map((r) => ({
      serviceDate: r.serviceDate,
      value: r.morningWorship as number,
    }));

  const inMonth = worshipByDate
    .filter((r) => withinRange(r.serviceDate, { year, month }, shiftMonth(year, month, 1)))
    .map((r) => r.value);

  const ytd = worshipByDate
    .filter((r) =>
      withinRange(r.serviceDate, { year, month: 1 }, shiftMonth(year, month, 1)),
    )
    .map((r) => r.value);

  const sixStart = shiftMonth(year, month, -5);
  const currentSix = worshipByDate
    .filter((r) =>
      withinRange(r.serviceDate, sixStart, shiftMonth(year, month, 1)),
    )
    .map((r) => r.value);

  const prev = shiftMonth(year, month, -1);
  const prevMonth = worshipByDate
    .filter((r) =>
      withinRange(r.serviceDate, prev, { year, month }),
    )
    .map((r) => r.value);

  const priorYtd = worshipByDate
    .filter((r) =>
      withinRange(
        r.serviceDate,
        { year: year - 1, month: 1 },
        shiftMonth(year - 1, month, 1),
      ),
    )
    .map((r) => r.value);

  const prevSixEnd = { year, month };
  const prevSixStart = shiftMonth(year, month, -11);
  const previousSix = worshipByDate
    .filter((r) => withinRange(r.serviceDate, prevSixStart, prevSixEnd))
    .map((r) => r.value);

  const monthlyAverage = average(inMonth);
  const ytdAverage = average(ytd);
  const currentSixMonthAverage = average(currentSix);
  const prevMonthAverage = average(prevMonth);
  const priorYtdAverage = average(priorYtd);
  const previousSixMonthAverage = average(previousSix);

  return {
    monthlyAverage,
    ytdAverage,
    currentSixMonthAverage,
    prevMonthAverage,
    priorYtdAverage,
    previousSixMonthAverage,
    monthToMonthGrowthPct: growthPct(monthlyAverage, prevMonthAverage),
    ytdGrowthPct: growthPct(ytdAverage, priorYtdAverage),
    sixMonthChangePct: growthPct(currentSixMonthAverage, previousSixMonthAverage),
  };
}

export function formatAttendanceTableDate(iso: string): string {
  const d = parseServiceDate(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(d.year, d.month - 1, d.day));
}

export function formatPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatAverage(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

export { monthKey };
