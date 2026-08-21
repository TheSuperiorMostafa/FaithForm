import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";

import { MonthlyPdfDocument } from "@/components/library/pdf-monthly-report";
import { getMonthlyReportData } from "@/lib/reports/monthly-data";
import { requireChurchContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/server";
import { parseMonthParam } from "@/lib/utils/reports";

export const runtime = "nodejs";

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

  try {
    const data = await getMonthlyReportData(
      supabase,
      ctx.churchId,
      parsed.year,
      parsed.month,
    );

    const buffer = await renderToBuffer(
      createElement(MonthlyPdfDocument, data) as ReactElement<DocumentProps>,
    );

    const filename = `monthly-${month}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("monthly report:", error);
    return NextResponse.json(
      { error: "Failed to generate monthly report" },
      { status: 500 },
    );
  }
}
