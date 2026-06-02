import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import type { GivingDonationRow } from "@/types/giving";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica" },
  churchName: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
  address: { fontSize: 10, color: "#64748b", marginBottom: 16 },
  title: { fontSize: 14, fontWeight: "bold", marginBottom: 12 },
  donor: { marginBottom: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 6,
  },
  header: { fontWeight: "bold", marginBottom: 8 },
  total: { marginTop: 16, fontSize: 13, fontWeight: "bold" },
  disclaimer: {
    marginTop: 24,
    fontSize: 9,
    color: "#64748b",
    lineHeight: 1.4,
  },
});

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
  const totalCents = input.gifts.reduce((s, g) => s + g.amountCents, 0);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.churchName}>{input.churchName}</Text>
        {input.statementAddress && (
          <Text style={styles.address}>{input.statementAddress}</Text>
        )}
        {input.ein && <Text style={styles.address}>EIN: {input.ein}</Text>}

        <Text style={styles.title}>
          {input.year} Contribution Statement
        </Text>

        <View style={styles.donor}>
          <Text>{input.donorName}</Text>
          <Text style={styles.address}>{input.donorEmail}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.header}>Date</Text>
          <Text style={styles.header}>Fund</Text>
          <Text style={styles.header}>Amount</Text>
        </View>

        {input.gifts.map((g) => (
          <View key={g.id} style={styles.row}>
            <Text>
              {new Date(g.createdAt).toLocaleDateString("en-US")}
            </Text>
            <Text>{g.fundName ?? "General"}</Text>
            <Text>{formatMoney(g.amountCents)}</Text>
          </View>
        ))}

        <Text style={styles.total}>
          Total contributions: {formatMoney(totalCents)}
        </Text>

        <Text style={styles.disclaimer}>
          No goods or services were provided in exchange for these contributions.
          Please retain this statement for your tax records. {input.churchName}
          {input.ein ? ` (EIN ${input.ein})` : ""} is a tax-exempt organization.
        </Text>
      </Page>
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
