import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import React from "react";

import {
  BILLING_CYCLE,
  FAITHFORM_BILLING,
  PAYMENT_TERMS,
  PLAN_NAME,
  formatCents,
  formatInvoiceDateLong,
  formatPeriodLabel,
  lineTotalCents,
  type ChurchInvoice,
} from "@/lib/billing/invoice";
import { pdfColors } from "@/lib/reports/pdf-theme";

/*
 * The monthly invoice, laid out like FaithForm's existing invoice template:
 * navy header with a gold INVOICE mark, Billed to and Service period side by
 * side, the line items table, then the totals. Built-in Helvetica, like the
 * other report PDFs, so rendering needs no font files.
 */

// Service names and details wrap at spaces, never split with a hyphen.
const noHyphens = (word: string) => [word];

const INK = "#111827";
const MUTED = "#4B5563";
const HAIRLINE = "#D1D5DB";

const styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 56,
    paddingHorizontal: 0,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: INK,
    backgroundColor: pdfColors.white,
  },
  header: {
    backgroundColor: pdfColors.navy,
    paddingVertical: 28,
    paddingHorizontal: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  company: { fontSize: 18, fontFamily: "Helvetica-Bold", color: pdfColors.white, marginBottom: 6 },
  companyLine: { fontSize: 9, color: "#C5D4E8", marginBottom: 2 },
  invoiceMark: {
    fontSize: 30,
    fontFamily: "Helvetica-Bold",
    color: pdfColors.gold,
    letterSpacing: 3,
    textAlign: "right",
    marginBottom: 8,
  },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 2 },
  metaLabel: { fontSize: 9, color: "#C5D4E8", marginRight: 6 },
  metaValue: { fontSize: 9, fontFamily: "Helvetica-Bold", color: pdfColors.white },
  goldRule: { height: 4, backgroundColor: pdfColors.gold },
  body: { paddingHorizontal: 40, paddingTop: 28 },
  blocks: { flexDirection: "row", marginBottom: 28 },
  block: { flex: 1, paddingRight: 16 },
  blockTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: pdfColors.navy,
    letterSpacing: 1.2,
    paddingBottom: 4,
    marginBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: pdfColors.gold,
  },
  blockStrong: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  blockLine: { fontSize: 10, color: MUTED, marginBottom: 2 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: pdfColors.navy,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: pdfColors.white, letterSpacing: 0.8 },
  tr: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  colService: { width: "34%", paddingRight: 8 },
  colDetail: { width: "34%", paddingRight: 8 },
  colQty: { width: "8%", textAlign: "center" },
  colUnit: { width: "12%", textAlign: "right" },
  colTotal: { width: "12%", textAlign: "right" },
  serviceText: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  detailText: { fontSize: 9, color: MUTED },
  cell: { fontSize: 10 },
  totals: { marginTop: 16, marginLeft: "auto", width: "44%" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  totalLabel: { fontSize: 10, color: MUTED },
  totalValue: { fontSize: 10 },
  dueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: pdfColors.navy,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 6,
    borderLeftWidth: 4,
    borderLeftColor: pdfColors.gold,
  },
  dueLabel: { fontSize: 11, fontFamily: "Helvetica-Bold", color: pdfColors.white, letterSpacing: 0.8 },
  dueValue: { fontSize: 13, fontFamily: "Helvetica-Bold", color: pdfColors.gold },
  terms: { fontSize: 9, fontFamily: "Helvetica-Bold", color: pdfColors.navy, textAlign: "right", marginTop: 6 },
  stamp: {
    marginTop: 18,
    alignSelf: "flex-start",
    borderWidth: 2,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
  },
  notesTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", color: pdfColors.navy, marginTop: 24, marginBottom: 4 },
  notes: { fontSize: 9, color: MUTED, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 8, color: MUTED },
});

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function InvoicePdfDocument({ invoice }: { invoice: ChurchInvoice }) {
  const { billedTo } = invoice;
  const period = formatPeriodLabel(invoice.periodStart);

  return (
    <Document
      title={`Invoice ${invoice.invoiceNumber}`}
      author={FAITHFORM_BILLING.company}
      subject={`${PLAN_NAME}, ${period}`}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>{FAITHFORM_BILLING.company}</Text>
            <Text style={styles.companyLine}>{FAITHFORM_BILLING.email}</Text>
            <Text style={styles.companyLine}>{FAITHFORM_BILLING.phone}</Text>
            <Text style={styles.companyLine}>{FAITHFORM_BILLING.website}</Text>
          </View>
          <View>
            <Text style={styles.invoiceMark}>INVOICE</Text>
            <Meta label="Invoice #:" value={invoice.invoiceNumber} />
            <Meta label="Invoice Date:" value={formatInvoiceDateLong(invoice.invoiceDate)} />
          </View>
        </View>
        <View style={styles.goldRule} />

        <View style={styles.body}>
          <View style={styles.blocks}>
            <View style={styles.block}>
              <Text style={styles.blockTitle}>BILLED TO</Text>
              {billedTo.organization ? <Text style={styles.blockStrong}>{billedTo.organization}</Text> : null}
              {billedTo.contactName ? <Text style={styles.blockLine}>{billedTo.contactName}</Text> : null}
              {billedTo.email ? <Text style={styles.blockLine}>{billedTo.email}</Text> : null}
              {billedTo.phone ? <Text style={styles.blockLine}>{billedTo.phone}</Text> : null}
            </View>
            <View style={styles.block}>
              <Text style={styles.blockTitle}>SERVICE PERIOD</Text>
              <Text style={styles.blockStrong}>{period}</Text>
              <Text style={styles.blockLine}>Service Type: {PLAN_NAME}</Text>
              <Text style={styles.blockLine}>Billing Cycle: {BILLING_CYCLE}</Text>
            </View>
          </View>

          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colService]}>SERVICE / DESCRIPTION</Text>
            <Text style={[styles.th, styles.colDetail]}>DETAIL</Text>
            <Text style={[styles.th, styles.colQty]}>QTY</Text>
            <Text style={[styles.th, styles.colUnit]}>UNIT</Text>
            <Text style={[styles.th, styles.colTotal]}>TOTAL</Text>
          </View>
          {invoice.lineItems.map((line, index) => {
            const total = lineTotalCents(line);
            return (
              <View key={index} style={styles.tr} wrap={false}>
                <Text style={[styles.serviceText, styles.colService]} hyphenationCallback={noHyphens}>{line.description}</Text>
                <Text style={[styles.detailText, styles.colDetail]} hyphenationCallback={noHyphens}>{line.detail}</Text>
                <Text style={[styles.cell, styles.colQty]}>{String(line.qty)}</Text>
                <Text style={[styles.cell, styles.colUnit]}>
                  {line.unitCents === null ? "Included" : formatCents(line.unitCents)}
                </Text>
                <Text style={[styles.cell, styles.colTotal]}>{total === null ? "—" : formatCents(total)}</Text>
              </View>
            );
          })}

          <View style={styles.totals} wrap={false}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCents(invoice.subtotalCents)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>EXEMPT</Text>
            </View>
            <View style={styles.dueRow}>
              <Text style={styles.dueLabel}>TOTAL DUE</Text>
              <Text style={styles.dueValue}>{formatCents(invoice.totalCents)}</Text>
            </View>
            <Text style={styles.terms}>{PAYMENT_TERMS}</Text>
          </View>

          {invoice.status === "paid" ? (
            <Text style={[styles.stamp, { color: "#047857", borderColor: "#047857" }]}>
              PAID{invoice.paidAt ? ` ${formatInvoiceDateLong(invoice.paidAt.slice(0, 10))}` : ""}
            </Text>
          ) : invoice.status === "void" ? (
            <Text style={[styles.stamp, { color: MUTED, borderColor: MUTED }]}>VOID</Text>
          ) : null}

          {invoice.notes ? (
            <View wrap={false}>
              <Text style={styles.notesTitle}>NOTES</Text>
              <Text style={styles.notes}>{invoice.notes}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Thank you for serving with FaithForm.</Text>
          <Text style={styles.footerText}>
            Questions? {FAITHFORM_BILLING.email} · {FAITHFORM_BILLING.phone}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
