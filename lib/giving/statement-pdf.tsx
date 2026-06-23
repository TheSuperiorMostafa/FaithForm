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

export type StatementPdfInput = {
  churchName: string;
  ein: string | null;
  statementAddress: string | null;
  donorName: string;
  donorEmail: string;
  year: number;
  gifts: GivingDonationRow[];
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function StatementDocument({ input }: { input: StatementPdfInput }) {
  const totalCents = input.gifts.reduce((sum, gift) => sum + gift.amountCents, 0);
  const reportDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const churchMeta: string[] = [];
  if (input.statementAddress) {
    churchMeta.push(input.statementAddress);
  }
  if (input.ein) {
    churchMeta.push(`EIN: ${input.ein}`);
  }

  const tableRows = input.gifts.map((gift) => ({
    date: new Date(gift.createdAt).toLocaleDateString("en-US"),
    fund: gift.fundName ?? "General",
    amount: formatMoney(gift.amountCents),
  }));

  const disclaimer = `No goods or services were provided in exchange for these contributions. Please retain this statement for your tax records. ${input.churchName}${input.ein ? ` (EIN ${input.ein})` : ""} is a tax-exempt organization.`;

  return (
    <Document>
      <ReportPage>
        <ReportHeader
          churchName={input.churchName}
          periodLabel={String(input.year)}
          reportType={`${input.year} Contribution Statement`}
        />

        {churchMeta.length > 0 ? (
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

        <InfoCard
          title="DONOR"
          name={input.donorName}
          lines={[input.donorEmail]}
        />

        <DataTable
          columns={[
            { key: "date", label: "Date", width: "28%" },
            { key: "fund", label: "Fund", width: "44%" },
            { key: "amount", label: "Amount", width: "28%", align: "right" },
          ]}
          rows={tableRows}
          emptyMessage="No contributions recorded for this year."
        />

        <TotalHighlightRow
          label="Total contributions"
          value={formatMoney(totalCents)}
        />

        <CalloutBox>{disclaimer}</CalloutBox>

        <ReportFooter
          reportDate={reportDate}
          churchName={input.churchName}
          badge="Tax record"
        />
      </ReportPage>
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
