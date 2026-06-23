import React from "react";
import { Document } from "@react-pdf/renderer";
import {
  CalloutBox,
  DataTable,
  KpiGrid,
  MiniBarChart,
  ReportFooter,
  ReportHeader,
  ReportPage,
  SectionTitle,
} from "@/components/library/pdf-primitives";

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

export function AttendancePdfDocument({
  churchName,
  monthLabel,
  weeks,
  trendSummary,
  reportDate,
}: AttendancePdfProps) {
  const sundaysTracked = weeks.length;
  const averagePresent =
    sundaysTracked > 0
      ? Math.round(
          weeks.reduce((sum, week) => sum + week.present, 0) / sundaysTracked,
        )
      : 0;
  const totalFollowUps = weeks.reduce((sum, week) => sum + week.followUps, 0);

  const barPoints = weeks.map((week) => ({
    label: week.date.replace(/,?\s*\d{4}$/, "").slice(0, 8),
    value: week.present,
  }));

  const tableRows = weeks.map((week) => ({
    date: week.date,
    present: String(week.present),
    absent: String(week.absent),
    followUps: String(week.followUps),
  }));

  return (
    <Document>
      <ReportPage>
        <ReportHeader
          churchName={churchName}
          periodLabel={monthLabel}
          reportType="Attendance Report"
        />

        <KpiGrid
          items={[
            {
              value: String(sundaysTracked),
              label: "SUNDAYS TRACKED",
            },
            {
              value: String(averagePresent),
              label: "AVERAGE PRESENT",
            },
            {
              value: String(totalFollowUps),
              label: "TOTAL FOLLOW-UPS",
            },
          ]}
        />

        <SectionTitle>WEEKLY ATTENDANCE</SectionTitle>
        <MiniBarChart points={barPoints} />

        <DataTable
          columns={[
            { key: "date", label: "Date", width: "38%" },
            { key: "present", label: "Present", width: "18%", align: "right" },
            { key: "absent", label: "Absent", width: "18%", align: "right" },
            {
              key: "followUps",
              label: "Follow-ups",
              width: "26%",
              align: "right",
            },
          ]}
          rows={tableRows}
          emptyMessage="No attendance records for this month."
        />

        <SectionTitle>TREND SUMMARY</SectionTitle>
        <CalloutBox>{trendSummary}</CalloutBox>

        <ReportFooter reportDate={reportDate} churchName={churchName} />
      </ReportPage>
    </Document>
  );
}
