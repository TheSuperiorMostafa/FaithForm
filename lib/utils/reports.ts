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
  if (month < 1 || month > 12) return null;

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
