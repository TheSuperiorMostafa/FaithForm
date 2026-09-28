import React from "react";
import { Document, Text, pdf } from "@react-pdf/renderer";
import {
  CalloutBox,
  DataTable,
  InfoCard,
  ReportFooter,
  ReportHeader,
  ReportPage,
  TotalHighlightRow,
} from "@/components/library/pdf-primitives";
import type { GivingDonationRow } from "@/types/giving";
import { sheetDate } from "@/lib/giving/spreadsheet";
import { statementPageSizes } from "@/lib/giving/statement-pages";

export type StatementPdfInput = {
  churchName: string;
  ein: string | null;
  statementAddress: string | null;
  donorName: string;
  donorEmail: string;
  year: number;
  gifts: GivingDonationRow[];
  timeZone?: string;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatStatementDate(iso: string, timeZone: string): string {
  const [year, month, day] = sheetDate(iso, timeZone).split("-");
  if (!year || !month || !day) throw new Error("A gift has an unreadable date.");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function StatementDocument({ input }: { input: StatementPdfInput }) {
  const timeZone = input.timeZone ?? "UTC";
  const totalCents = input.gifts.reduce((sum, gift) => sum + gift.amountCents, 0);
  const reportDay = sheetDate(new Date(), timeZone);
  const reportDate = new Date(`${reportDay}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const churchMeta: string[] = [];
  if (input.statementAddress) {
    churchMeta.push(input.statementAddress);
  }
  if (input.ein) {
    churchMeta.push(`EIN: ${input.ein}`);
  }

  const tableRows = input.gifts.map((gift) => ({
    date: formatStatementDate(gift.createdAt, timeZone),
    fund: (gift.fundName ?? "General").replace(/\s+/g, " ").trim() || "General",
    amount: formatMoney(gift.amountCents),
  }));

  const disclaimer = `This is a summary of gifts recorded by ${input.churchName}. Contact the church for questions about tax treatment or anything received in return for a gift.`;

  // Fund names are unrestricted in the database. Budget extra vertical room
  // when one wraps rather than letting a continuation page lose its heading.
  const longestFund = tableRows.reduce((longest, row) => Math.max(longest, row.fund.length), 0);
  const linesPerRow = Math.max(1, Math.ceil(longestFund / 38));
  const pageSizes = statementPageSizes(tableRows.length, linesPerRow);
  let offset = 0;

  return (
    <Document>
      {pageSizes.map((size, index) => {
        const rows = tableRows.slice(offset, offset + size);
        offset += size;
        const first = index === 0;
        const last = index === pageSizes.length - 1;
        return (
          <ReportPage key={index}>
        <ReportHeader
          churchName={input.churchName}
          periodLabel={String(input.year)}
          reportType={`${input.year} Contribution Statement`}
        />

        {first && churchMeta.length > 0 ? (
          <Text
            style={{
              fontSize: 9,
              color: "#6B7280",
              marginBottom: 16,
              lineHeight: 1.4,
            }}
          >
            {churchMeta.join(" · ")}
          </Text>
        ) : null}

        {first ? (
          <InfoCard title="DONOR" name={input.donorName} lines={[input.donorEmail]} />
        ) : (
          <Text style={{ fontSize: 9, color: "#6B7280", marginBottom: 12 }}>
            {input.donorName} · continued
          </Text>
        )}

        <DataTable
          columns={[
            { key: "date", label: "Date", width: "28%" },
            { key: "fund", label: "Fund", width: "44%" },
            { key: "amount", label: "Amount", width: "28%", align: "right" },
          ]}
          rows={rows}
          emptyMessage="No contributions recorded for this year."
        />

        {last ? (
          <>
            <TotalHighlightRow label="Total contributions" value={formatMoney(totalCents)} />
            <CalloutBox>{disclaimer}</CalloutBox>
          </>
        ) : null}

        <ReportFooter
          reportDate={reportDate}
          churchName={input.churchName}
          badge={`Giving record · Page ${index + 1} of ${pageSizes.length}`}
        />
          </ReportPage>
        );
      })}
    </Document>
  );
}

export async function renderGivingStatementPdf(
  input: StatementPdfInput,
): Promise<Buffer> {
  const doc = <StatementDocument input={input} />;
  const blob = await pdf(doc).toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
