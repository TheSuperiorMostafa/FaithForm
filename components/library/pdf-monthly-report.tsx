import React from "react";
import { Document, Text } from "@react-pdf/renderer";
import {
  BodyColumns,
  CalloutBox,
  HeroMetric,
  KpiGrid,
  LifetimeStatsCard,
  ProgressRow,
  ReportFooter,
  ReportHeader,
  ReportPage,
  SectionTitle,
} from "@/components/library/pdf-primitives";

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
  const maxAutomationMinutes = Math.max(
    ...topAutomations.map((row) => row.minutes),
    1,
  );

  return (
    <Document>
      <ReportPage>
        <ReportHeader
          churchName={churchName}
          periodLabel={monthLabel}
          reportType="Monthly Report"
        />

        <HeroMetric
          value={hoursSavedThisMonth.toFixed(2)}
          label="HOURS SAVED THIS MONTH"
          subtitle="Your automation system ran quietly in the background handling tasks, calls, and communications so you could focus more on your ministry."
        />

        <KpiGrid
          items={[
            {
              value: String(tasksCompletedThisMonth),
              label: "Tasks off your plate",
            },
            {
              value: String(callsHandledThisMonth),
              label: "Calls you did not have to think about",
            },
            {
              value: `${lifetimeHoursSaved.toFixed(2)} hrs`,
              label: "Total hours returned",
            },
          ]}
        />

        <BodyColumns
          left={
            <>
              <SectionTitle>TOP AUTOMATIONS THIS MONTH</SectionTitle>
              {topAutomations.length === 0 ? (
                <Text style={{ fontSize: 9, color: "#6B7280" }}>
                  No automations recorded for this month.
                </Text>
              ) : (
                topAutomations.map((row) => (
                  <ProgressRow
                    key={row.rank}
                    large
                    label={`${row.rank}. ${row.label}`}
                    valueLabel={`${row.minutes} min`}
                    percent={(row.minutes / maxAutomationMinutes) * 100}
                  />
                ))
              )}
            </>
          }
          right={
            <>
              <SectionTitle>LIFETIME STATS</SectionTitle>
              <LifetimeStatsCard
                stats={[
                  {
                    value: String(lifetimeTasksCompleted),
                    label: "Lifetime Tasks Completed",
                  },
                  {
                    value: `${lifetimeHoursSaved.toFixed(2)} hrs`,
                    label: "Lifetime Hours Saved",
                  },
                  {
                    value: String(lifetimeRentalsBooked),
                    label: "Total Rentals Booked",
                  },
                ]}
              />
            </>
          }
        />

        <CalloutBox>{narrative}</CalloutBox>

        <ReportFooter reportDate={reportDate} churchName={churchName} />
      </ReportPage>
    </Document>
  );
}
