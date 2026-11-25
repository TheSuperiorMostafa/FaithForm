import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canViewChurchBilling } from "@/lib/billing/access";
import {
  canChangeInvoiceStatus,
  computeInvoiceTotals,
  currentPeriodStart,
  defaultLineItems,
  formatCents,
  formatInvoiceDate,
  formatInvoiceDateLong,
  formatPeriodLabel,
  invoiceFileName,
  isInvoiceNumber,
  lineTotalCents,
  mapInvoiceRow,
  normalizePeriodStart,
  parseDollarsToCents,
  parseStoredLineItems,
  toStoredLineItems,
} from "@/lib/billing/invoice";

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";

test("the template invoice is a $250 retainer plus an included portal line", () => {
  const lines = defaultLineItems();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].unitCents, 25_000);
  assert.equal(lines[1].unitCents, null);
  assert.deepEqual(computeInvoiceTotals(lines), { subtotalCents: 25_000, totalCents: 25_000 });
  assert.equal(lineTotalCents(lines[1]), null, "Included lines print a dash, not $0.00");
});

test("totals multiply quantity by unit price and ignore included lines", () => {
  const totals = computeInvoiceTotals([
    { description: "A", detail: "", qty: 3, unitCents: 1_999 },
    { description: "B", detail: "", qty: 1, unitCents: null },
    { description: "C", detail: "", qty: 2, unitCents: 50 },
  ]);
  assert.equal(totals.subtotalCents, 6_097);
  assert.equal(totals.totalCents, totals.subtotalCents, "tax exempt");
  assert.deepEqual(computeInvoiceTotals([]), { subtotalCents: 0, totalCents: 0 });
});

test("money formats and parses without floating point drift", () => {
  assert.equal(formatCents(25_000), "$250.00");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatCents(1_234_567), "$12,345.67");
  assert.equal(parseDollarsToCents("250"), 25_000);
  assert.equal(parseDollarsToCents("$1,250.5"), 125_050);
  assert.equal(parseDollarsToCents("0.29"), 29);
  assert.equal(parseDollarsToCents(" 19.99 "), 1_999);
  for (const bad of ["", "-5", "1.234", "abc", "1e3", "."]) {
    assert.equal(parseDollarsToCents(bad), null, bad);
  }
});

test("invoice numbers, months and dates read as written, never shifted by time zone", () => {
  assert.ok(isInvoiceNumber("FFT-1001"));
  assert.ok(isInvoiceNumber("FFT-12345"));
  assert.ok(!isInvoiceNumber("FFT-12"));
  assert.ok(!isInvoiceNumber("INV-1001"));
  assert.equal(normalizePeriodStart("2026-11"), "2026-11-01");
  assert.equal(normalizePeriodStart("2026-11-01"), "2026-11-01");
  assert.equal(normalizePeriodStart("2026-13"), null);
  assert.equal(normalizePeriodStart("2026-11-15"), null);
  assert.equal(normalizePeriodStart("1999-01"), null);
  assert.equal(formatPeriodLabel("2026-01-01"), "January 2026");
  assert.equal(formatInvoiceDate("2026-12-01"), "Dec 1, 2026");
  assert.equal(formatInvoiceDateLong("2026-11-03"), "November 3, 2026");
  assert.equal(invoiceFileName({ invoiceNumber: "FFT-1001", periodStart: "2026-11-01" }), "FFT-1001-November-2026.pdf");
  // 03:30 UTC on Dec 1 is still November in New York.
  assert.equal(currentPeriodStart(new Date("2026-12-01T03:30:00Z"), "America/New_York"), "2026-11-01");
  assert.equal(currentPeriodStart(new Date("2026-12-01T03:30:00Z"), "UTC"), "2026-12-01");
});

test("stored line items round-trip and bad rows are made safe", () => {
  const lines = defaultLineItems(30_000);
  assert.deepEqual(parseStoredLineItems(toStoredLineItems(lines)), lines);
  assert.deepEqual(parseStoredLineItems(null), []);
  assert.deepEqual(parseStoredLineItems([null, { description: "X", qty: -2, unit_cents: -1 }]), [
    { description: "X", detail: "", qty: 1, unitCents: null },
  ]);
  const invoice = mapInvoiceRow({
    id: "i",
    church_id: CHURCH_A,
    invoice_number: "FFT-1001",
    invoice_date: "2026-11-03",
    period_start: "2026-11-01",
    status: "surprise",
    paid_at: null,
    voided_at: null,
    line_items: toStoredLineItems(lines),
    subtotal_cents: 30_000,
    total_cents: 30_000,
    billed_to: { organization: "Grace Church", contact_name: "Pat", email: "p@example.org", phone: "555" },
    notes: null,
    created_at: "2026-11-03T12:00:00Z",
  });
  assert.equal(invoice.status, "due", "an unknown status is treated as due, never as paid");
  assert.equal(invoice.billedTo.contactName, "Pat");
});

test("status changes: paid and due toggle, void is final", () => {
  assert.ok(canChangeInvoiceStatus("due", "paid"));
  assert.ok(canChangeInvoiceStatus("paid", "due"));
  assert.ok(canChangeInvoiceStatus("due", "void"));
  assert.ok(canChangeInvoiceStatus("paid", "void"));
  assert.ok(!canChangeInvoiceStatus("void", "due"));
  assert.ok(!canChangeInvoiceStatus("void", "paid"));
  assert.ok(!canChangeInvoiceStatus("due", "due"));
});

test("only an admin of the invoice's church, or a platform admin, can open it", () => {
  const churchAdmin = { isPlatformAdmin: false, churchId: CHURCH_A, isChurchAdmin: true };
  const churchStaff = { isPlatformAdmin: false, churchId: CHURCH_A, isChurchAdmin: false };
  const otherChurchAdmin = { isPlatformAdmin: false, churchId: CHURCH_B, isChurchAdmin: true };
  const platformAdmin = { isPlatformAdmin: true, churchId: null, isChurchAdmin: false };
  const noChurch = { isPlatformAdmin: false, churchId: null, isChurchAdmin: true };

  assert.equal(canViewChurchBilling(churchAdmin, CHURCH_A), true);
  assert.equal(canViewChurchBilling(churchStaff, CHURCH_A), false, "non-admin teammate");
  assert.equal(canViewChurchBilling(otherChurchAdmin, CHURCH_A), false, "another church's admin");
  assert.equal(canViewChurchBilling(platformAdmin, CHURCH_A), true);
  assert.equal(canViewChurchBilling(noChurch, CHURCH_A), false);
  assert.equal(canViewChurchBilling(null, CHURCH_A), false, "signed out");
  assert.equal(canViewChurchBilling(churchAdmin, null), false);
});

test("the migration keeps writes server-side and reads to church admins", () => {
  const sql = readFileSync("supabase/migrations/0181_church_invoices.sql", "utf8");
  assert.match(sql, /start with 1001/);
  assert.match(sql, /using \(public\.is_church_admin\(church_id\)\)/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*to authenticated/i);
  assert.match(sql, /where status <> 'void'/, "one live invoice per church per month");
  const route = readFileSync("app/api/billing/invoices/[id]/route.ts", "utf8");
  assert.match(route, /canViewChurchBilling\(viewer, invoice\.churchId\)/);
  assert.match(route, /private, no-store/);
});
