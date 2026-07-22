import React from "react";
import { Document, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  MiniLineChart,
  ReportFooter,
  ReportPage,
  SectionTitle,
} from "@/components/library/pdf-primitives";
import {
  formatAverage,
  formatPct,
  type AttendanceComparisonMetrics,
  type AttendanceWeekRow,
} from "@/lib/reports/attendance-metrics";
import { pdfColors, pdfFontSizes, pdfSpacing } from "@/lib/reports/pdf-theme";

export type AttendancePdfProps = {
  churchName: string;
  monthLabel: string;
  weeks: AttendanceWeekRow[];
  metrics: AttendanceComparisonMetrics;
  reportDate: string;
};

const styles = StyleSheet.create({
  titleBlock: {
    marginBottom: pdfSpacing.section,
  },
  churchName: {
    fontSize: 18,
    fontWeight: "bold",
    color: pdfColors.navy,
    marginBottom: 4,
  },
  reportTitle: {
    fontSize: 12,
    color: pdfColors.muted,
    marginBottom: 2,
  },
  period: {
    fontSize: 11,
    fontWeight: "bold",
    color: pdfColors.gold,
  },
  table: {
    marginTop: pdfSpacing.tight,
    marginBottom: pdfSpacing.section,
    borderWidth: 1,
    borderColor: pdfColors.border,
    borderRadius: 4,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: pdfColors.navy,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableHeaderCell: {
    color: pdfColors.white,
    fontSize: pdfFontSizes.small,
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: pdfColors.border,
  },
  tableRowAlt: {
    backgroundColor: pdfColors.navyTint,
  },
  tableCell: {
    fontSize: pdfFontSizes.body,
    color: pdfColors.navy,
  },
  colDate: { width: "40%" },
  colSchool: { width: "30%", textAlign: "right" },
  colWorship: { width: "30%", textAlign: "right" },
  empty: {
    padding: 12,
    fontSize: pdfFontSizes.body,
    color: pdfColors.muted,
  },
  metricsRow: {
    flexDirection: "row",
    marginTop: pdfSpacing.section,
    gap: 10,
  },
  metricsCol: {
    flex: 1,
  },
  metricLine: {
    marginBottom: 16,
  },
  metricLabel: {
    fontSize: 8,
    color: pdfColors.muted,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 12,
    fontWeight: "bold",
    color: pdfColors.navy,
  },
  growthPositive: {
    backgroundColor: "#16A34A",
    color: pdfColors.white,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: "bold",
    alignSelf: "flex-start",
  },
  growthNegative: {
    backgroundColor: "#DC2626",
    color: pdfColors.white,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 10,
    fontWeight: "bold",
    alignSelf: "flex-start",
  },
  growthNeutral: {
    fontSize: 12,
    fontWeight: "bold",
    color: pdfColors.navy,
  },
  note: {
    marginTop: pdfSpacing.block,
    fontSize: 7,
    color: pdfColors.muted,
  },
});

function GrowthBadge({ value }: { value: number | null }) {
  if (value == null) {
    return <Text style={styles.growthNeutral}>—</Text>;
  }
  if (value > 0) {
    return <Text style={styles.growthPositive}>{formatPct(value)}</Text>;
  }
  if (value < 0) {
    return <Text style={styles.growthNegative}>{formatPct(value)}</Text>;
  }
  return <Text style={styles.growthNeutral}>{formatPct(value)}</Text>;
}

export function AttendancePdfDocument({
  churchName,
  monthLabel,
  weeks,
  metrics,
  reportDate,
}: AttendancePdfProps) {
  const chartPoints = weeks
    .filter((w) => w.morningWorship != null)
    .map((w) => ({
      label: w.dateLabel.replace(/,?\s*\d{4}$/, "").slice(0, 12),
      value: w.morningWorship as number,
    }));

  return (
    <Document>
      <ReportPage>
        <View style={styles.titleBlock}>
          <Text style={styles.period}>{monthLabel}</Text>
          <Text style={styles.churchName}>{churchName}</Text>
          <Text style={styles.reportTitle}>Attendance Report</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colDate]}>Date</Text>
            <Text style={[styles.tableHeaderCell, styles.colSchool]}>
              Sunday School
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colWorship]}>
              Morning Worship
            </Text>
          </View>
          {weeks.length === 0 ? (
            <Text style={styles.empty}>No attendance records for this month.</Text>
          ) : (
            weeks.map((week, index) => (
              <View
                key={week.serviceDate}
                style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}
              >
                <Text style={[styles.tableCell, styles.colDate]}>
                  {week.dateLabel}
                </Text>
                <Text style={[styles.tableCell, styles.colSchool]}>
                  {week.sundaySchool == null ? "" : String(week.sundaySchool)}
                </Text>
                <Text style={[styles.tableCell, styles.colWorship]}>
                  {week.morningWorship == null
                    ? ""
                    : String(week.morningWorship)}
                </Text>
              </View>
            ))
          )}
        </View>

        <SectionTitle>{`Morning Worship Attendance – ${monthLabel}`}</SectionTitle>
        <MiniLineChart points={chartPoints} />

        <View style={styles.metricsRow}>
          <View style={styles.metricsCol}>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>Monthly Average</Text>
              <Text style={styles.metricValue}>
                {formatAverage(metrics.monthlyAverage)}
              </Text>
            </View>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>YTD Average</Text>
              <Text style={styles.metricValue}>
                {formatAverage(metrics.ytdAverage)}
              </Text>
            </View>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>Current 6 Month Average</Text>
              <Text style={styles.metricValue}>
                {formatAverage(metrics.currentSixMonthAverage)}
              </Text>
            </View>
          </View>

          <View style={styles.metricsCol}>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>Prev Month Average</Text>
              <Text style={styles.metricValue}>
                {formatAverage(metrics.prevMonthAverage)}
              </Text>
            </View>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>Prior YTD</Text>
              <Text style={styles.metricValue}>
                {formatAverage(metrics.priorYtdAverage)}
              </Text>
            </View>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>Previous 6 Month Average</Text>
              <Text style={styles.metricValue}>
                {formatAverage(metrics.previousSixMonthAverage)}
              </Text>
            </View>
          </View>

          <View style={styles.metricsCol}>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>Month to Month % Growth</Text>
              <GrowthBadge value={metrics.monthToMonthGrowthPct} />
            </View>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>YTD % Growth</Text>
              <GrowthBadge value={metrics.ytdGrowthPct} />
            </View>
            <View style={styles.metricLine}>
              <Text style={styles.metricLabel}>6 Month % Change</Text>
              <GrowthBadge value={metrics.sixMonthChangePct} />
            </View>
          </View>
        </View>

        <Text style={styles.note}>
          Morning Worship uses headcount from weekly attendance. Sunday School
          counts can be added when that service is tracked separately.
        </Text>

        <ReportFooter reportDate={reportDate} churchName={churchName} />
      </ReportPage>
    </Document>
  );
}
