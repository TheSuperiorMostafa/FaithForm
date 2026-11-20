import type { UsageReportRow } from "@/lib/service-plans/songs/types";
import { csvCell } from "@/lib/utils/csv";

/**
 * The song usage spreadsheet a church sends with its CCLI report. Pure, so
 * the columns and escaping can be tested without a database. A byte-order
 * mark and CRLF endings so it opens cleanly in Excel, Numbers and Sheets.
 */
export const USAGE_REPORT_HEADERS = [
  "Date",
  "Service type",
  "Plan title",
  "Song title",
  "Author",
  "CCLI number",
  "Arrangement",
  "Key",
] as const;

export function usageReportCsv(rows: readonly UsageReportRow[]): string {
  const lines = [
    USAGE_REPORT_HEADERS.map(csvCell).join(","),
    ...rows.map((r) =>
      [r.date, r.serviceType, r.planTitle, r.songTitle, r.author, r.ccliNumber, r.arrangement, r.key]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Validates `from`/`to` query values; null when they aren't a usable range. */
export function parseUsageRange(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to || !YMD.test(from) || !YMD.test(to)) return null;
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null;
  // Five years is far more than any licence report needs.
  if (b - a > 5 * 366 * 86_400_000) return null;
  return { from, to };
}
