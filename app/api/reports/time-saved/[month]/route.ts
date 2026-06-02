import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";

import {
  TIME_SAVED_CATEGORIES,
  TimeSavedPdfDocument,
  type CategoryBreakdown,
} from "@/components/library/pdf-time-saved-report";
import { getChurchName } from "@/lib/queries/library";
import { requireChurchContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate, parseMonthParam } from "@/lib/utils/reports";

export const runtime = "nodejs";

type ActivityRow = {
  executed_at: string;
  category: string | null;
  task_name: string | null;
  time_saved_minutes: number | null;
  automation_type: string | null;
};

function buildBreakdown(rows: ActivityRow[]) {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const cat = row.category?.trim() || "Other";
    const minutes = row.time_saved_minutes ?? 0;
    totals.set(cat, (totals.get(cat) ?? 0) + minutes);
  }

  const standardSet = new Set<string>(TIME_SAVED_CATEGORIES);
  let otherMinutes = 0;

  for (const [cat, minutes] of Array.from(totals.entries())) {
    if (!standardSet.has(cat)) {
      otherMinutes += minutes;
    }
  }

  const breakdown: CategoryBreakdown[] = TIME_SAVED_CATEGORIES.map(
    (category) => {
    const minutes = totals.get(category) ?? 0;
      return {
        category,
        minutes,
        hours: minutes / 60,
      };
    },
  );

  if (otherMinutes > 0) {
    breakdown.push({
      category: "Other",
      minutes: otherMinutes,
      hours: otherMinutes / 60,
    });
  }

  return breakdown;
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

  const [churchName, logResult] = await Promise.all([
    getChurchName(supabase, churchId),
    supabase
      .from("activity_log")
      .select(
        "executed_at,category,task_name,time_saved_minutes,automation_type",
      )
      .eq("church_id", churchId)
      .gte("executed_at", parsed.start.toISOString())
      .lt("executed_at", parsed.end.toISOString())
      .order("executed_at", { ascending: true }),
  ]);

  if (logResult.error) {
    console.error("time-saved report:", logResult.error.message);
    return NextResponse.json(
      { error: "Failed to load activity data" },
      { status: 500 },
    );
  }

  const rows = (logResult.data ?? []) as ActivityRow[];
  const totalMinutes = rows.reduce(
    (sum, r) => sum + (r.time_saved_minutes ?? 0),
    0,
  );
  const totalHours = totalMinutes / 60;

  const automations = rows.map((row) => ({
    date: formatShortDate(row.executed_at),
    taskName:
      row.task_name?.trim() ||
      row.automation_type?.trim() ||
      "Automation",
    category: row.category?.trim() || "—",
    minutes: row.time_saved_minutes ?? 0,
  }));

  const generatedAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  const buffer = await renderToBuffer(
    createElement(TimeSavedPdfDocument, {
      churchName,
      monthLabel: parsed.label,
      totalHours,
      breakdown: buildBreakdown(rows),
      automations,
      generatedAt,
    }) as ReactElement<DocumentProps>,
  );

  const filename = `time-saved-${params.month}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
