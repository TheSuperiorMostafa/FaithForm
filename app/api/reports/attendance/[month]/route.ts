import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";

import { AttendancePdfDocument } from "@/components/library/pdf-attendance-report";
import { getChurchName } from "@/lib/queries/library";
import {
  buildAttendanceComparisonMetrics,
  formatAttendanceTableDate,
} from "@/lib/reports/attendance-metrics";
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
  { params }: { params: { month: string } },
) {
  const parsed = parseMonthParam(params.month);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  const supabase = createClient();
  const ctx = await requireChurchContext(supabase);
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { churchId } = ctx;

  // Need ~18 months of history for YTD / prior-YTD / rolling 6-month averages.
  const historyStart = new Date(parsed.year - 1, 0, 1);
  const historyStartIso = `${historyStart.getFullYear()}-01-01`;

  const [churchName, recordsResult] = await Promise.all([
    getChurchName(supabase, churchId),
    supabase
      .from("attendance_records")
      .select("service_date,total_present")
      .eq("church_id", churchId)
      .gte("service_date", historyStartIso)
      .lt("service_date", parsed.endDateIso)
      .order("service_date", { ascending: true }),
  ]);

  if (recordsResult.error) {
    console.error("attendance report:", recordsResult.error.message);
    return NextResponse.json(
      { error: "Failed to load attendance data" },
      { status: 500 },
    );
  }

  const records = (recordsResult.data ?? []) as AttendanceRecord[];

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

  const filename = `attendance-${params.month}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
