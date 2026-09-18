import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";

import { AttendancePdfDocument } from "@/components/library/pdf-attendance-report";
import { getPresenceByDate, isSundayIsoDate } from "@/lib/attendance/presence";
import { getChurchName } from "@/lib/queries/library";
import {
  buildAttendanceComparisonMetrics,
  formatAttendanceTableDate,
} from "@/lib/reports/attendance-metrics";
import { featureAccessDenied } from "@/lib/features/guard";
import { requireChurchContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/server";
import { parseMonthParam } from "@/lib/utils/reports";

export const runtime = "nodejs";

type AttendanceRecord = {
  service_date: string;
  total_present: number | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  const parsed = parseMonthParam(month);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  const supabase = createClient();
  const ctx = await requireChurchContext(supabase);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await featureAccessDenied("attendance", supabase);
  if (denied) return denied;

  const { churchId } = ctx;

  // Need ~18 months of history for YTD / prior-YTD / rolling 6-month averages.
  const historyStart = new Date(parsed.year - 1, 0, 1);
  const historyStartIso = `${historyStart.getFullYear()}-01-01`;

  // The report's range ends before `endDateIso`; the totals take both ends.
  const lastDay = new Date(`${parsed.endDateIso}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const lastDayIso = lastDay.toISOString().slice(0, 10);

  const [churchName, presence] = await Promise.all([
    getChurchName(supabase, churchId),
    // Each Sunday's attendance counts everyone recorded any way — the weekly
    // sheet, the app, a code, the kiosk or a room — once. Null on a database
    // without migration 0083, where the weekly sheets are read directly.
    getPresenceByDate(supabase, churchId, historyStartIso, lastDayIso),
  ]);

  let records: AttendanceRecord[];
  if (presence) {
    records = Array.from(presence.entries())
      .filter(([date, day]) => isSundayIsoDate(date) && (day.hasSheet || day.present > 0))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, day]) => ({ service_date: date, total_present: day.present }));
  } else {
    const recordsResult = await supabase
      .from("attendance_records")
      .select("service_date,total_present")
      .eq("church_id", churchId)
      .gte("service_date", historyStartIso)
      .lt("service_date", parsed.endDateIso)
      .order("service_date", { ascending: true });

    if (recordsResult.error) {
      console.error("attendance report:", recordsResult.error.message);
      return NextResponse.json(
        { error: "Failed to load attendance data" },
        { status: 500 },
      );
    }

    records = (recordsResult.data ?? []) as AttendanceRecord[];
  }

  const allRows = records.map((row) => ({
    serviceDate: row.service_date,
    sundaySchool: null as number | null,
    morningWorship: row.total_present,
  }));

  const weeks = allRows
    .filter((row) => {
      return (
        row.serviceDate >= parsed.startDateIso &&
        row.serviceDate < parsed.endDateIso
      );
    })
    .map((row) => ({
      dateLabel: formatAttendanceTableDate(row.serviceDate),
      serviceDate: row.serviceDate,
      sundaySchool: row.sundaySchool,
      morningWorship: row.morningWorship,
    }));

  const metrics = buildAttendanceComparisonMetrics(
    allRows,
    parsed.year,
    parsed.month,
  );

  const reportDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(new Date());

  const buffer = await renderToBuffer(
    createElement(AttendancePdfDocument, {
      churchName,
      monthLabel: parsed.label,
      weeks,
      metrics,
      reportDate,
    }) as ReactElement<DocumentProps>,
  );

  const filename = `attendance-${month}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
