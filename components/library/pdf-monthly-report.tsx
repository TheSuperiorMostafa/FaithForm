import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export type TopAutomationRow = {
  rank: number;
  label: string;
  minutes: number;
};

export type MonthlyPdfProps = {
  churchName: string;
  monthLabel: string;
  hoursSavedThisMonth: number;
  tasksCompletedThisMonth: number;
  callsHandledThisMonth: number;
  lifetimeHoursSaved: number;
  lifetimeTasksCompleted: number;
  lifetimeRentalsBooked: number;
  topAutomations: TopAutomationRow[];
  narrative: string;
  reportDate: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#002D5F",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  headerLeft: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#002D5F",
    maxWidth: "55%",
  },
  headerRight: {
    alignItems: "flex-end",
    maxWidth: "40%",
  },
  poweredBy: {
    fontSize: 8,
    color: "#6B7280",
    marginBottom: 2,
  },
  reportType: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#002D5F",
  },
  hero: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#C5A059",
    marginBottom: 4,
  },
  heroLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#002D5F",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  tagline: {
    fontSize: 9,
    color: "#6B7280",
    lineHeight: 1.5,
    marginBottom: 24,
    maxWidth: "90%",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
    borderTopWidth: 1,
    borderTopColor: "#DDD9D0",
    borderBottomWidth: 1,
    borderBottomColor: "#DDD9D0",
    paddingVertical: 12,
  },
  statCol: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#002D5F",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#6B7280",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  bodyRow: {
    flexDirection: "row",
    gap: 24,
    marginBottom: 24,
  },
  bodyCol: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#C5A059",
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  automationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    fontSize: 9,
  },
  automationRank: {
    width: 14,
    color: "#002D5F",
    fontWeight: "bold",
  },
  automationLabel: {
    flex: 1,
    color: "#002D5F",
    paddingRight: 8,
  },
  automationMinutes: {
    color: "#6B7280",
    textAlign: "right",
  },
  lifetimeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    fontSize: 9,
  },
  lifetimeValue: {
    fontWeight: "bold",
    color: "#002D5F",
  },
  lifetimeLabel: {
    color: "#002D5F",
    flex: 1,
    paddingRight: 8,
  },
  narrative: {
    fontSize: 9,
    lineHeight: 1.55,
    color: "#002D5F",
    marginBottom: 40,
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

function StatColumn({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function MonthlyPdfDocument({
  churchName,
  monthLabel,
  hoursSavedThisMonth,
  tasksCompletedThisMonth,
  callsHandledThisMonth,
  lifetimeHoursSaved,
  lifetimeTasksCompleted,
  lifetimeRentalsBooked,
  topAutomations,
  narrative,
  reportDate,
}: MonthlyPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.headerLeft}>
            {churchName}  {monthLabel}
          </Text>
          <View style={styles.headerRight}>
            <Text style={styles.poweredBy}>Powered by FaithForm Technologies</Text>
            <Text style={styles.reportType}>Monthly Report</Text>
          </View>
        </View>

        <Text style={styles.hero}>{hoursSavedThisMonth.toFixed(2)}</Text>
        <Text style={styles.heroLabel}>HOURS SAVED THIS MONTH</Text>
        <Text style={styles.tagline}>
          Your automation system ran quietly in the background handling tasks, calls,
          and communications so you could focus more on your ministry
        </Text>

        <View style={styles.statRow}>
          <StatColumn
            value={String(tasksCompletedThisMonth)}
            label="TASKS COMPLETED"
          />
          <StatColumn
            value={String(callsHandledThisMonth)}
            label="CALLS HANDLED"
          />
          <StatColumn
            value={`${lifetimeHoursSaved.toFixed(2)}hrs`}
            label="LIFETIME HOURS SAVED"
          />
        </View>

        <View style={styles.bodyRow}>
          <View style={styles.bodyCol}>
            <Text style={styles.sectionTitle}>TOP AUTOMATIONS THIS MONTH</Text>
            {topAutomations.length === 0 ? (
              <Text style={{ fontSize: 9, color: "#6B7280" }}>
                No automations recorded for this month.
              </Text>
            ) : (
              topAutomations.map((row) => (
                <View key={row.rank} style={styles.automationRow}>
                  <Text style={styles.automationRank}>{row.rank}</Text>
                  <Text style={styles.automationLabel}>{row.label}</Text>
                  <Text style={styles.automationMinutes}>{row.minutes} min</Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.bodyCol}>
            <Text style={styles.sectionTitle}>LIFETIME STATS</Text>
            <View style={styles.lifetimeRow}>
              <Text style={styles.lifetimeValue}>
                {lifetimeTasksCompleted}
              </Text>
              <Text style={styles.lifetimeLabel}>Lifetime Tasks Completed</Text>
            </View>
            <View style={styles.lifetimeRow}>
              <Text style={styles.lifetimeValue}>
                {lifetimeHoursSaved.toFixed(2)} hrs
              </Text>
              <Text style={styles.lifetimeLabel}>Lifetime Hours Saved</Text>
            </View>
            <View style={styles.lifetimeRow}>
              <Text style={styles.lifetimeValue}>
                {lifetimeRentalsBooked}
              </Text>
              <Text style={styles.lifetimeLabel}>Total Rentals Booked</Text>
            </View>
          </View>
        </View>

        <Text style={styles.narrative}>{narrative}</Text>

        <View style={styles.footer}>
          <Text>
            {reportDate} · CONFIDENTIAL
          </Text>
          <Text>{churchName}</Text>
        </View>
      </Page>
    </Document>
  );
}
