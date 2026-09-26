import { csvCell } from "@/lib/utils/csv";
import {
  depositStatus,
  intervalLabel,
  recurringState,
  recurringStatus,
} from "@/lib/giving/labels";

/**
 * The Giving spreadsheets a treasurer downloads: donors, recurring gifts and
 * deposits. Pure functions only, so the columns, the escaping and the formula
 * guard are unit-tested without a database.
 *
 * Every file opens in Excel, Numbers and Google Sheets: a UTF-8 byte-order
 * mark so "José" isn't garbled in Excel, CRLF line endings, plain column
 * headers, dollars (not cents) and dates in the church's own time zone.
 */

export const SPREADSHEET_KINDS = ["donors", "recurring", "deposits"] as const;
export type SpreadsheetKind = (typeof SPREADSHEET_KINDS)[number];

export function isSpreadsheetKind(value: string): value is SpreadsheetKind {
  return (SPREADSHEET_KINDS as readonly string[]).includes(value);
}

type Cell = string | number | null | undefined;

const BOM = "﻿";

/** A whole CSV file. Each cell goes through `csvCell` (quotes + formula guard). */
export function toCsv(headers: readonly string[], rows: readonly (readonly Cell[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** 1250 → "12.50". Blank when there is no amount. */
export function dollars(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function safeZone(timeZone: string | null | undefined): string {
  const zone = timeZone || "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "America/New_York";
  }
}

/**
 * "2026-09-26" in the church's time zone. Year-month-day sorts correctly and
 * every spreadsheet reads it as a date. Blank for a missing or bad date.
 */
export function sheetDate(value: string | number | Date | null | undefined, timeZone: string): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The calendar year it is right now for the church. */
export function churchYear(now: Date, timeZone: string): number {
  return Number(sheetDate(now, timeZone).slice(0, 4));
}

/** `donors-2026-09-26.csv`, dated in the church's time zone. */
export function spreadsheetFilename(kind: SpreadsheetKind, now: Date, timeZone: string): string {
  return `${kind}-${sheetDate(now, timeZone)}.csv`;
}

// ---------------------------------------------------------------------------
// Donors
// ---------------------------------------------------------------------------

export type DonorSheetRow = {
  name: string | null;
  email: string | null;
  totalCents: number;
  yearCents: number;
  giftCount: number;
  firstGiftAt: string | null;
  lastGiftAt: string | null;
  recurringCents: number;
};

export function donorsCsv(rows: readonly DonorSheetRow[], timeZone: string, year: number): string {
  return toCsv(
    [
      "Name",
      "Email",
      `Given in ${year}`,
      "Total given",
      "Number of gifts",
      "First gift",
      "Last gift",
      "Recurring amount",
    ],
    rows.map((d) => [
      d.name?.trim() || "",
      d.email ?? "",
      dollars(d.yearCents),
      dollars(d.totalCents),
      d.giftCount,
      sheetDate(d.firstGiftAt, timeZone),
      sheetDate(d.lastGiftAt, timeZone),
      d.recurringCents > 0 ? dollars(d.recurringCents) : "",
    ]),
  );
}

// ---------------------------------------------------------------------------
// Recurring gifts
// ---------------------------------------------------------------------------

export type RecurringSheetRow = {
  donorName: string | null;
  donorEmail: string | null;
  amountCents: number;
  interval: string | null;
  status: string | null;
  pausedAt: string | null;
  fundName: string | null;
  fundDesignation: string | null;
  createdAt: string | null;
};

export function recurringCsv(rows: readonly RecurringSheetRow[], timeZone: string): string {
  return toCsv(
    ["Name", "Email", "Recurring amount", "Frequency", "Fund", "Status", "Started", "Paused since"],
    rows.map((s) => [
      s.donorName?.trim() || "",
      s.donorEmail ?? "",
      dollars(s.amountCents),
      intervalLabel(s.interval),
      s.fundName ?? s.fundDesignation ?? "",
      recurringStatus(s.status, s.pausedAt).label,
      sheetDate(s.createdAt, timeZone),
      recurringState(s.status, s.pausedAt) === "paused" ? sheetDate(s.pausedAt, timeZone) : "",
    ]),
  );
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

/** The few payout fields the sheet uses (a subset of Stripe's payout). */
export type DepositSheetRow = {
  amount: number;
  currency: string | null;
  status: string | null;
  /** Unix seconds; the provider's calendar day at midnight UTC. */
  arrival_date: number | null;
  /** Unix seconds. */
  created: number | null;
};

export function depositsCsv(rows: readonly DepositSheetRow[], timeZone: string): string {
  return toCsv(
    ["Deposit date", "Amount", "Currency", "Status", "Started"],
    rows.map((p) => [
      // The arrival day is already a calendar date (midnight UTC), so it is
      // read in UTC; shifting it into the church's zone would move it a day.
      p.arrival_date ? sheetDate(p.arrival_date * 1000, "UTC") : "",
      dollars(p.amount),
      (p.currency ?? "usd").toUpperCase(),
      depositStatus(p.status).label,
      p.created ? sheetDate(p.created * 1000, timeZone) : "",
    ]),
  );
}
