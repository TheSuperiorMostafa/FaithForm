import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";

import { AttendancePdfDocument } from "@/components/library/pdf-attendance-report";
import { getChurchName } from "@/lib/queries/library";
import { requireChurchContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/server";
import {
  formatServiceDate,
  parseMonthParam,
} from "@/lib/utils/reports";

export const runtime = "nodejs";

type AttendanceEntry = { follow_up_requested: boolean | null };

type AttendanceRecord = {
  service_date: string;
  total_present: number | null;
  total_absent: number | null;
  attendance_entries: AttendanceEntry[] | null;
};

function buildTrendSummary(
  weeks: { present: number; followUps: number }[],
): string {
  if (weeks.length === 0) {
    return "No attendance data recorded for this month.";
  }

  const avg =
    weeks.reduce((sum, w) => sum + w.present, 0) / weeks.length;
  const first = weeks[0].present;
  const last = weeks[weeks.length - 1].present;
  const totalFollowUps = weeks.reduce((sum, w) => sum + w.followUps, 0);
  const delta = last - first;

  let trend = "held steady";
  if (delta > 0) trend = `trended up by ${delta} from first to last service`;
  else if (delta < 0)
    trend = `trended down by ${Math.abs(delta)} from first to last service`;

  const sundayLabel = weeks.length === 1 ? "Sunday" : "Sundays";

  return `Average attendance: ${Math.round(avg)} present per service across ${weeks.length} ${sundayLabel}. Attendance ${trend}. ${totalFollowUps} follow-up${totalFollowUps === 1 ? "" : "s"} sent.`;
}

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

  const [churchName, recordsResult] = await Promise.all([
    getChurchName(supabase, churchId),
    supabase
      .from("attendance_records")
      .select(
        "service_date,total_present,total_absent,attendance_entries(follow_up_requested)",
      )
      .eq("church_id", churchId)
      .gte("service_date", parsed.startDateIso)
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

  const weeks = records.map((row) => {
    const entries = row.attendance_entries ?? [];
    const followUps = entries.filter((e) => e.follow_up_requested === true)
      .length;
    return {
      date: formatServiceDate(row.service_date),
      present: row.total_present ?? 0,
      absent: row.total_absent ?? 0,
      followUps,
    };
  });

  const generatedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  const buffer = await renderToBuffer(
    createElement(AttendancePdfDocument, {
      churchName,
      monthLabel: parsed.label,
      weeks,
      trendSummary: buildTrendSummary(weeks),
      generatedAt,
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
