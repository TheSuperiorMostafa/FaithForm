import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export type AttendanceWeekRow = {
  date: string;
  present: number;
  absent: number;
  followUps: number;
};

export type AttendancePdfProps = {
  churchName: string;
  monthLabel: string;
  weeks: AttendanceWeekRow[];
  trendSummary: string;
  reportDate: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#002D5F",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#002D5F",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#C5A059",
    marginBottom: 8,
    marginTop: 16,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#002D5F",
    color: "#FFFFFF",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontWeight: "bold",
    fontSize: 9,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#DDD9D0",
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 9,
  },
  colDate: { width: "38%" },
  colNum: { width: "18%", textAlign: "right" },
  colFollow: { width: "26%", textAlign: "right" },
  trend: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 1.5,
    color: "#002D5F",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  poweredBy: {
    fontSize: 8,
    color: "#6B7280",
    marginBottom: 2,
    textAlign: "right",
  },
  reportType: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#002D5F",
    textAlign: "right",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#6B7280",
  },
});

function HeaderRow() {
  return (
    <View style={styles.tableHeader}>
      <Text style={styles.colDate}>Date</Text>
      <Text style={styles.colNum}>Present</Text>
      <Text style={styles.colNum}>Absent</Text>
      <Text style={styles.colFollow}>Follow-ups</Text>
    </View>
  );
}

export function AttendancePdfDocument({
  churchName,
  monthLabel,
  weeks,
  trendSummary,
  reportDate,
}: AttendancePdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>{churchName}</Text>
            <Text style={styles.subtitle}>Attendance Report — {monthLabel}</Text>
          </View>
          <View>
            <Text style={styles.poweredBy}>Powered by FaithForm Technologies</Text>
            <Text style={styles.reportType}>Attendance Report</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Weekly attendance</Text>
        <HeaderRow />
        {weeks.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={{ width: "100%", color: "#6B7280" }}>
              No attendance records for this month.
            </Text>
          </View>
        ) : (
          weeks.map((week, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.colDate}>{week.date}</Text>
              <Text style={styles.colNum}>{week.present}</Text>
              <Text style={styles.colNum}>{week.absent}</Text>
              <Text style={styles.colFollow}>{week.followUps}</Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Trend summary</Text>
        <Text style={styles.trend}>{trendSummary}</Text>

        <View style={styles.footer}>
          <Text>{reportDate} · CONFIDENTIAL</Text>
          <Text>{churchName}</Text>
        </View>
      </Page>
    </Document>
  );
}
