import { NextResponse } from "next/server";

import { featureAccessDenied } from "@/lib/features/guard";
import { requireChurchContext } from "@/lib/reports/auth";
import { songUsageReport } from "@/lib/service-plans/songs/queries";
import { parseUsageRange, usageReportCsv } from "@/lib/service-plans/songs/report";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/plans/songs/usage?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Every song sung in a dated plan between the two dates (inclusive), as a
 * spreadsheet for the church's CCLI report. Read with the signed-in user's own
 * client, so RLS decides what they see.
 */
export async function GET(request: Request) {
  const supabase = createClient();
  const ctx = await requireChurchContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const denied = await featureAccessDenied("service_plans", supabase);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const range = parseUsageRange(params.get("from"), params.get("to"));
  if (!range) {
    return NextResponse.json(
      { error: "Choose a start date on or before the end date, up to five years apart." },
      { status: 400 },
    );
  }

  try {
    const rows = await songUsageReport(supabase, ctx.churchId, range);
    return new NextResponse(usageReportCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="song-usage-${range.from}-to-${range.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("song usage report:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "We couldn't make the song report. Please try again." }, { status: 500 });
  }
}
