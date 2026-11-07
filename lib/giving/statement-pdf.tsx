import React from "react";
import { Document, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { statementAcknowledgment, statementFundTotals } from "@/lib/giving/statement-content";
import { sheetDate } from "@/lib/giving/spreadsheet";
import { statementPageSizes } from "@/lib/giving/statement-pages";
import type { GivingDonationRow } from "@/types/giving";

export type StatementPdfInput = {
  churchName: string;
  ein: string | null;
  statementAddress: string | null;
  churchPhone?: string | null;
  churchEmail?: string | null;
  timeZone?: string;
  donorName: string;
  /** Retained for callers; donor email is never printed on a contribution statement. */
  donorEmail?: string;
  year: number;
  gifts: GivingDonationRow[];
};

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: "#202020", backgroundColor: "#FFFFFF", paddingTop: 40, paddingHorizontal: 42, paddingBottom: 118 },
  church: { fontSize: 17, fontWeight: "bold", marginBottom: 6 },
  contact: { fontSize: 9, lineHeight: 1.5, color: "#444444" },
  title: { fontSize: 21, marginTop: 22, marginBottom: 7 },
  donor: { marginTop: 20, marginBottom: 20 },
  label: { fontSize: 9, color: "#555555", marginBottom: 5 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#DDDDDD", paddingVertical: 6 },
  header: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#777777", paddingVertical: 8, fontWeight: "bold" },
  date: { width: "20%", paddingRight: 8 },
  fund: { width: "34%", paddingRight: 8 },
  type: { width: "24%", paddingRight: 8 },
  amount: { width: "22%", textAlign: "right" },
  summary: { marginTop: 20 },
  summaryTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 5 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#777777", paddingTop: 10, marginTop: 8, fontSize: 12, fontWeight: "bold" },
  footer: { position: "absolute", bottom: 26, left: 42, width: 528, height: 72, color: "#444444", fontSize: 8, lineHeight: 1.5 },
});

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatStatementDate(iso: string, timeZone: string): string {
  const [year, month, day] = sheetDate(iso, timeZone).split("-");
  if (!year || !month || !day) throw new Error("A gift has an unreadable date.");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function StatementDocument({ input }: { input: StatementPdfInput }) {
  const timeZone = input.timeZone ?? "UTC";
  const totalCents = input.gifts.reduce((sum, gift) => sum + gift.amountCents, 0);
  const funds = statementFundTotals(input.gifts);
  const rows = input.gifts.map((gift) => ({
    ...gift,
    date: formatStatementDate(gift.createdAt, timeZone),
    fund: (gift.fundName || gift.fundDesignation || "General").replace(/\s+/g, " ").trim() || "General",
  }));
  // Retain explicit page budgets so every continuation page has its heading.
  // The gift-type column narrows the fund column compared with the old report.
  const longestFund = rows.reduce((length, row) => Math.max(length, row.fund.length), 0);
  const pageSizes = statementPageSizes(rows.length, Math.max(2, Math.ceil(longestFund / 28)));
  let offset = 0;
  const giftPages = pageSizes.map((size) => {
    const pageRows = rows.slice(offset, offset + size);
    offset += size;
    return { gifts: pageRows, funds: [] as typeof funds };
  });
  // Many designated funds need their own headed pages rather than pushing the
  // total and acknowledgment onto an unheaded overflow page.
  const summaryLines = funds.reduce((count, fund) => count + Math.max(1, Math.ceil(fund.name.length / 60)), 0);
  if (summaryLines <= 4) {
    giftPages[giftPages.length - 1]!.funds = funds;
  } else {
    const longestSummaryName = funds.reduce((length, fund) => Math.max(length, fund.name.length), 0);
    const summarySizes = statementPageSizes(funds.length, Math.max(1, Math.ceil(longestSummaryName / 60)));
    let fundOffset = 0;
    for (const size of summarySizes) {
      giftPages.push({ gifts: [], funds: funds.slice(fundOffset, fundOffset + size) });
      fundOffset += size;
    }
  }
  return (
    <Document title={`${input.year} Contribution statement`} author={input.churchName}>
      {giftPages.map((page, index) => {
        const first = index === 0;
        const last = index === giftPages.length - 1;
        return <Page key={index} size="LETTER" style={styles.page}>
          <Text style={styles.church}>{input.churchName}</Text>
          {first ? [input.statementAddress, input.churchPhone, input.churchEmail, input.ein ? `EIN ${input.ein}` : null]
            .filter(Boolean).map((line, lineIndex) => <Text key={lineIndex} style={styles.contact}>{line}</Text>) : null}
          <Text style={styles.title}>Contribution statement</Text>
          <Text>Statement period: Jan 1 - Dec 31, {input.year}</Text>
          <View style={styles.donor} wrap={false}>
            <Text style={styles.label}>{first ? "Prepared for" : "Continued for"}</Text>
            <Text>{input.donorName}</Text>
          </View>
          {page.gifts.length > 0 || first ? <>
            <View style={styles.header} wrap={false}>
              <Text style={styles.date}>Date</Text><Text style={styles.fund}>Fund</Text>
              <Text style={styles.type}>Gift type</Text><Text style={styles.amount}>Amount</Text>
            </View>
            {page.gifts.length === 0 ? <Text style={{ paddingVertical: 12 }}>No contributions recorded for this year.</Text> : page.gifts.map((gift) => (
              <View key={gift.id} style={styles.row} wrap={false}>
                <Text style={styles.date}>{gift.date}</Text>
                <Text style={styles.fund}>{gift.fund}</Text>
                <Text style={styles.type}>{gift.giftType === "recurring" ? "Recurring" : "One-time"}</Text>
                <Text style={styles.amount}>{money(gift.amountCents)}</Text>
              </View>
            ))}
          </> : null}
          {page.funds.length > 0 || last ? <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Contributions by fund</Text>
            {page.funds.map((fund, fundIndex) => <View key={fundIndex} style={styles.totalRow} wrap={false}><Text style={{ width: "78%", paddingRight: 12 }}>{fund.name}</Text><Text>{money(fund.amountCents)}</Text></View>)}
            {last ? <View style={styles.grandTotal} wrap={false}><Text>Total contributions</Text><Text>{money(totalCents)}</Text></View> : null}
          </View> : null}
          <View style={styles.footer} fixed>
            <Text>{statementAcknowledgment(input.churchName, input.ein)}</Text>
            <Text style={{ marginTop: 7 }}>Contribution statement · Page {index + 1} of {giftPages.length}</Text>
          </View>
        </Page>;
      })}
    </Document>
  );
}

export async function renderGivingStatementPdf(input: StatementPdfInput): Promise<Buffer> {
  const blob = await pdf(<StatementDocument input={input} />).toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
