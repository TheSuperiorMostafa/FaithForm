import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export const TIME_SAVED_CATEGORIES = [
  "Admin",
  "Communications",
  "Social",
  "Phone",
] as const;

export type CategoryBreakdown = {
  category: string;
  minutes: number;
  hours: number;
};

export type AutomationRow = {
  date: string;
  taskName: string;
  category: string;
  minutes: number;
};

export type TimeSavedPdfProps = {
  churchName: string;
  monthLabel: string;
  totalHours: number;
  breakdown: CategoryBreakdown[];
  automations: AutomationRow[];
  generatedAt: string;
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
    marginBottom: 20,
  },
  hero: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#C5A059",
    marginBottom: 4,
  },
  heroLabel: {
    fontSize: 11,
    color: "#6B7280",
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#C5A059",
    marginBottom: 8,
    marginTop: 12,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#DDD9D0",
    fontSize: 10,
  },
  autoRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#DDD9D0",
    fontSize: 8,
  },
  autoDate: { width: "22%" },
  autoTask: { width: "40%" },
  autoCat: { width: "22%" },
  autoMin: { width: "16%", textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#6B7280",
    textAlign: "center",
  },
});

export function TimeSavedPdfDocument({
  churchName,
  monthLabel,
  totalHours,
  breakdown,
  automations,
  generatedAt,
}: TimeSavedPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{churchName}</Text>
        <Text style={styles.subtitle}>Time Saved Report — {monthLabel}</Text>

        <Text style={styles.hero}>
          {totalHours.toFixed(1)} {totalHours === 1 ? "hour" : "hours"}
        </Text>
        <Text style={styles.heroLabel}>Total time saved this month</Text>

        <Text style={styles.sectionTitle}>Breakdown by category</Text>
        {breakdown.map((row) => (
          <View key={row.category} style={styles.breakdownRow}>
            <Text>{row.category}</Text>
            <Text>
              {row.hours.toFixed(1)} hr ({row.minutes} min)
            </Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Automations run</Text>
        {automations.length === 0 ? (
          <Text style={{ color: "#6B7280", fontSize: 9 }}>
            No automations logged for this month.
          </Text>
        ) : (
          automations.map((row, i) => (
            <View key={i} style={styles.autoRow}>
              <Text style={styles.autoDate}>{row.date}</Text>
              <Text style={styles.autoTask}>{row.taskName}</Text>
              <Text style={styles.autoCat}>{row.category}</Text>
              <Text style={styles.autoMin}>{row.minutes} min</Text>
            </View>
          ))
        )}

        <Text style={styles.footer}>Generated {generatedAt} · FaithForm</Text>
      </Page>
    </Document>
  );
}
