import {
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import React, { type ReactNode } from "react";
import {
  logoPath,
  pageStyle,
  pdfColors,
  pdfFontSizes,
  pdfSpacing,
} from "@/lib/reports/pdf-theme";

const styles = StyleSheet.create({
  headerBand: {
    backgroundColor: pdfColors.navy,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: pdfSpacing.section,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 12,
  },
  headerLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    marginRight: 10,
  },
  headerChurch: {
    fontSize: pdfFontSizes.title,
    fontWeight: "bold",
    color: pdfColors.white,
    marginBottom: 2,
  },
  headerPeriod: {
    fontSize: pdfFontSizes.small,
    color: "#C5D4E8",
  },
  headerRight: {
    alignItems: "flex-end",
    maxWidth: "38%",
  },
  poweredBy: {
    fontSize: 7,
    color: "#9BB0CC",
    marginBottom: 2,
  },
  reportType: {
    fontSize: 10,
    fontWeight: "bold",
    color: pdfColors.gold,
    textAlign: "right",
  },
  heroValue: {
    fontSize: pdfFontSizes.hero,
    fontWeight: "bold",
    color: pdfColors.gold,
    marginBottom: 4,
  },
  heroLabel: {
    fontSize: pdfFontSizes.subtitle,
    fontWeight: "bold",
    color: pdfColors.navy,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.muted,
    lineHeight: 1.5,
    marginBottom: pdfSpacing.section,
    maxWidth: "92%",
  },
  kpiGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: pdfSpacing.section,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: pdfColors.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderTopWidth: 3,
    borderTopColor: pdfColors.gold,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginHorizontal: 4,
    alignItems: "center",
  },
  kpiValue: {
    fontSize: pdfFontSizes.kpi,
    fontWeight: "bold",
    color: pdfColors.navy,
    marginBottom: 4,
  },
  kpiLabel: {
    fontSize: 7,
    fontWeight: "bold",
    color: pdfColors.muted,
    letterSpacing: 0.4,
    textAlign: "center",
  },
  sectionTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: pdfColors.gold,
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
  },
  callout: {
    borderLeftWidth: 3,
    borderLeftColor: pdfColors.gold,
    backgroundColor: pdfColors.navyTint,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: pdfSpacing.section,
  },
  calloutText: {
    fontSize: pdfFontSizes.body,
    lineHeight: 1.55,
    color: pdfColors.navy,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: pdfColors.navy,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: "bold",
    color: pdfColors.white,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
  },
  tableRowAlt: {
    backgroundColor: pdfColors.white,
  },
  tableCell: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.navy,
  },
  progressRow: {
    marginBottom: 8,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  progressLabel: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.navy,
    flex: 1,
    paddingRight: 8,
  },
  progressValue: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.muted,
  },
  progressTrack: {
    height: 6,
    backgroundColor: pdfColors.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    backgroundColor: pdfColors.gold,
    borderRadius: 3,
  },
  barChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 72,
    marginBottom: pdfSpacing.section,
    paddingHorizontal: 4,
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 2,
  },
  bar: {
    width: "70%",
    backgroundColor: pdfColors.gold,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginBottom: 4,
  },
  barLabel: {
    fontSize: 6,
    color: pdfColors.muted,
    textAlign: "center",
  },
  barValue: {
    fontSize: 7,
    fontWeight: "bold",
    color: pdfColors.navy,
    marginBottom: 2,
  },
  bodyRow: {
    flexDirection: "row",
    marginBottom: pdfSpacing.section,
  },
  bodyCol: {
    flex: 1,
    paddingHorizontal: 6,
  },
  lifetimeCard: {
    backgroundColor: pdfColors.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: pdfColors.border,
    padding: 10,
    marginBottom: 8,
  },
  lifetimeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    fontSize: pdfFontSizes.body,
  },
  lifetimeValue: {
    fontWeight: "bold",
    color: pdfColors.navy,
    width: 56,
  },
  lifetimeLabel: {
    flex: 1,
    color: pdfColors.navy,
    paddingLeft: 8,
  },
  infoCard: {
    backgroundColor: pdfColors.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: pdfColors.border,
    padding: 12,
    marginBottom: pdfSpacing.section,
  },
  infoTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: pdfColors.muted,
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  infoName: {
    fontSize: 11,
    fontWeight: "bold",
    color: pdfColors.navy,
    marginBottom: 2,
  },
  infoMuted: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.muted,
    marginBottom: 2,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: pdfColors.navy,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: pdfSpacing.section,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: "bold",
    color: pdfColors.white,
  },
  totalValue: {
    fontSize: 11,
    fontWeight: "bold",
    color: pdfColors.gold,
  },
  footerRule: {
    borderTopWidth: 2,
    borderTopColor: pdfColors.gold,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    position: "absolute",
    bottom: 28,
    left: pdfSpacing.page,
    right: pdfSpacing.page,
  },
  footerText: {
    fontSize: pdfFontSizes.small,
    color: pdfColors.muted,
  },
  emptyText: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.muted,
  },
});

export function ReportPage({ children }: { children: ReactNode }) {
  return (
    <Page size="LETTER" style={pageStyle}>
      {children}
    </Page>
  );
}

type ReportHeaderProps = {
  churchName: string;
  periodLabel: string;
  reportType: string;
};

export function ReportHeader({
  churchName,
  periodLabel,
  reportType,
}: ReportHeaderProps) {
  const logo = logoPath();

  return (
    <View style={styles.headerBand}>
      <View style={styles.headerLeft}>
        {logo ? <Image src={logo} style={styles.headerLogo} /> : null}
        <View>
          <Text style={styles.headerChurch}>{churchName}</Text>
          <Text style={styles.headerPeriod}>{periodLabel}</Text>
        </View>
      </View>
      <View style={styles.headerRight}>
        <Text style={styles.reportType}>{reportType}</Text>
      </View>
    </View>
  );
}

type ReportFooterProps = {
  reportDate: string;
  churchName: string;
  badge?: string;
};

export function ReportFooter({
  reportDate,
  churchName,
  badge = "CONFIDENTIAL",
}: ReportFooterProps) {
  return (
    <View style={styles.footerRule} fixed>
      <Text style={styles.footerText}>
        {reportDate} · {badge}
      </Text>
      <Text style={styles.footerText}>{churchName}</Text>
    </View>
  );
}

type HeroMetricProps = {
  value: string;
  label: string;
  subtitle?: string;
};

export function HeroMetric({ value, label, subtitle }: HeroMetricProps) {
  return (
    <View>
      <Text style={styles.heroValue}>{value}</Text>
      <Text style={styles.heroLabel}>{label}</Text>
      {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

type KpiItem = { value: string; label: string };

export function KpiGrid({ items }: { items: KpiItem[] }) {
  return (
    <View style={styles.kpiGrid}>
      {items.map((item) => (
        <View key={item.label} style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{item.value}</Text>
          <Text style={styles.kpiLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function CalloutBox({ children }: { children: string }) {
  return (
    <View style={styles.callout}>
      <Text style={styles.calloutText}>{children}</Text>
    </View>
  );
}

type TableColumn = {
  key: string;
  label: string;
  width: string;
  align?: "left" | "right";
};

type DataTableProps = {
  columns: TableColumn[];
  rows: Record<string, string>[];
  emptyMessage?: string;
};

export function DataTable({
  columns,
  rows,
  emptyMessage = "No records for this period.",
}: DataTableProps) {
  return (
    <View>
      <View style={styles.tableHeader}>
        {columns.map((col) => (
          <Text
            key={col.key}
            style={[
              styles.tableHeaderCell,
              { width: col.width, textAlign: col.align ?? "left" },
            ]}
          >
            {col.label}
          </Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <View style={[styles.tableRow, styles.tableRowAlt]}>
          <Text style={[styles.emptyText, { width: "100%" }]}>{emptyMessage}</Text>
        </View>
      ) : (
        rows.map((row, index) => (
          <View
            key={`${row[columns[0]?.key ?? "row"]}-${index}`}
            style={[styles.tableRow, index % 2 === 0 ? styles.tableRowAlt : {}]}
          >
            {columns.map((col) => (
              <Text
                key={col.key}
                style={[
                  styles.tableCell,
                  { width: col.width, textAlign: col.align ?? "left" },
                ]}
              >
                {row[col.key]}
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

type ProgressRowProps = {
  label: string;
  valueLabel: string;
  percent: number;
};

export function ProgressRow({ label, valueLabel, percent }: ProgressRowProps) {
  const width = `${Math.max(4, Math.min(100, percent))}%`;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>{valueLabel}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width }]} />
      </View>
    </View>
  );
}

type BarPoint = { label: string; value: number };

export function MiniBarChart({ points }: { points: BarPoint[] }) {
  if (points.length === 0) {
    return <Text style={styles.emptyText}>No data to chart.</Text>;
  }

  const max = Math.max(...points.map((p) => p.value), 1);

  return (
    <View style={styles.barChart}>
      {points.map((point) => {
        const height = Math.max(6, Math.round((point.value / max) * 52));
        return (
          <View key={point.label} style={styles.barCol}>
            <Text style={styles.barValue}>{point.value}</Text>
            <View style={[styles.bar, { height }]} />
            <Text style={styles.barLabel}>{point.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function BodyColumns({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <View style={styles.bodyRow}>
      <View style={styles.bodyCol}>{left}</View>
      <View style={styles.bodyCol}>{right}</View>
    </View>
  );
}

type LifetimeStat = { value: string; label: string };

export function LifetimeStatsCard({ stats }: { stats: LifetimeStat[] }) {
  return (
    <View style={styles.lifetimeCard}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.lifetimeRow}>
          <Text style={styles.lifetimeValue}>{stat.value}</Text>
          <Text style={styles.lifetimeLabel}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function InfoCard({
  title,
  name,
  lines,
}: {
  title: string;
  name: string;
  lines: string[];
}) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoName}>{name}</Text>
      {lines.map((line) => (
        <Text key={line} style={styles.infoMuted}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export function TotalHighlightRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}
