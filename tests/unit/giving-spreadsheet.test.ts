import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  churchYear,
  depositsCsv,
  dollars,
  donorsCsv,
  isSpreadsheetKind,
  recurringCsv,
  sheetDate,
  spreadsheetFilename,
  toCsv,
} from "@/lib/giving/spreadsheet";

const BOM = "﻿";

function lines(csv: string): string[] {
  assert.ok(csv.startsWith(BOM), "starts with a byte-order mark so Excel reads UTF-8");
  return csv.slice(1).replace(/\r\n$/, "").split("\r\n");
}

test("cells with commas, quotes and new lines are quoted", () => {
  const csv = toCsv(["Name", "Note"], [["Smith, John", 'Said "hi"\nthen left']]);
  assert.equal(csv, `${BOM}Name,Note\r\n"Smith, John","Said ""hi""\nthen left"\r\n`);
});

test("cells that would run as a formula are shown as text", () => {
  for (const attack of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", '=HYPERLINK("https://x","Open")']) {
    const [, row] = lines(toCsv(["Name"], [[attack]]));
    assert.ok(row.replace(/^"/, "").startsWith("'"), JSON.stringify(attack));
  }
  // A donor name typed on the public give form.
  const [, row] = lines(
    donorsCsv(
      [
        {
          name: "=cmd|' /C calc'!A0",
          email: "@evil.com",
          totalCents: 0,
          yearCents: 0,
          giftCount: 0,
          firstGiftAt: null,
          lastGiftAt: null,
          recurringCents: 0,
        },
      ],
      "America/New_York",
      2026,
    ),
  );
  assert.ok(row.startsWith("'=cmd"), row);
  assert.match(row, /,'@evil\.com,/);
});

test("amounts are dollars, not cents", () => {
  assert.equal(dollars(1250), "12.50");
  assert.equal(dollars(5), "0.05");
  assert.equal(dollars(0), "0.00");
  assert.equal(dollars(null), "");
});

test("dates are in the church's time zone", () => {
  // 02:30 UTC on Sep 27 is still Sep 26 in Chicago.
  assert.equal(sheetDate("2026-09-27T02:30:00Z", "America/Chicago"), "2026-09-26");
  assert.equal(sheetDate("2026-09-27T02:30:00Z", "Europe/London"), "2026-09-27");
  assert.equal(sheetDate(null, "America/Chicago"), "");
  assert.equal(sheetDate("not a date", "America/Chicago"), "");
  // A bad zone falls back instead of throwing.
  assert.equal(sheetDate("2026-09-26T15:00:00Z", "Not/AZone"), "2026-09-26");
  assert.equal(churchYear(new Date("2027-01-01T03:00:00Z"), "America/Los_Angeles"), 2026);
});

test("file name is the list and today's date", () => {
  assert.equal(
    spreadsheetFilename("donors", new Date("2026-09-26T18:00:00Z"), "America/New_York"),
    "donors-2026-09-26.csv",
  );
  assert.ok(isSpreadsheetKind("deposits"));
  assert.ok(!isSpreadsheetKind("../gifts"));
});

test("donors sheet uses plain headers and one row per donor", () => {
  const [header, row] = lines(
    donorsCsv(
      [
        {
          name: "Mary Jones",
          email: "mary@example.com",
          totalCents: 125000,
          yearCents: 50000,
          giftCount: 12,
          firstGiftAt: "2025-01-05T15:00:00Z",
          lastGiftAt: "2026-09-20T15:00:00Z",
          recurringCents: 5000,
        },
      ],
      "America/New_York",
      2026,
    ),
  );
  assert.equal(
    header,
    "Name,Email,Given in 2026,Total given,Number of gifts,First gift,Last gift,Recurring amount",
  );
  assert.equal(row, "Mary Jones,mary@example.com,500.00,1250.00,12,2025-01-05,2026-09-20,50.00");
});

test("recurring sheet names frequency and status in plain words", () => {
  const [header, paused, cancelled] = lines(
    recurringCsv(
      [
        {
          donorName: "Mary Jones",
          donorEmail: "mary@example.com",
          amountCents: 5000,
          interval: "month",
          status: "active",
          pausedAt: "2026-08-01T12:00:00Z",
          fundName: "Building",
          fundDesignation: null,
          createdAt: "2026-01-10T12:00:00Z",
        },
        {
          donorName: null,
          donorEmail: "guest@example.com",
          amountCents: 2000,
          interval: "week",
          status: "canceled",
          pausedAt: null,
          fundName: null,
          fundDesignation: "General",
          createdAt: "2026-02-01T12:00:00Z",
        },
      ],
      "America/New_York",
    ),
  );
  assert.equal(header, "Name,Email,Recurring amount,Frequency,Fund,Status,Started,Paused since");
  assert.equal(paused, "Mary Jones,mary@example.com,50.00,Every month,Building,Paused,2026-01-10,2026-08-01");
  assert.equal(cancelled, ",guest@example.com,20.00,Every week,General,Cancelled,2026-02-01,");
  assert.doesNotMatch(cancelled, /canceled|past_due/);
});

test("deposits sheet keeps the bank's arrival day", () => {
  const [header, row] = lines(
    depositsCsv(
      [
        {
          amount: 123456,
          currency: "usd",
          status: "in_transit",
          arrival_date: Date.UTC(2026, 8, 28) / 1000,
          created: Date.UTC(2026, 8, 26, 2, 0) / 1000,
        },
      ],
      "America/Los_Angeles",
    ),
  );
  assert.equal(header, "Deposit date,Amount,Currency,Status,Started");
  assert.equal(row, "2026-09-28,1234.56,USD,On the way,2026-09-25");
});

test("the export route is admin-only, feature-gated and never returns raw errors", () => {
  const source = readFileSync("app/api/dashboard/giving/export/[kind]/route.ts", "utf8");
  assert.match(source, /requireChurchAdmin\(\)/);
  assert.match(source, /featureAccessDenied\("giving"\)/);
  assert.match(source, /text\/csv/);
  assert.doesNotMatch(source, /error:\s*`?[^,}]*\b(error|err|e)\.message/);
  const data = readFileSync("lib/giving/spreadsheet-data.ts", "utf8");
  for (const table of ["giving_donors", "giving_donations", "giving_subscriptions"]) {
    assert.match(data, new RegExp(`from\\("${table}"\\)[\\s\\S]*?\\.eq\\("church_id", churchId\\)`));
  }
});
