import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/activity/admin-log";
import { forbiddenResponse, requireChurchAdmin } from "@/lib/auth/require-church-admin";
import { featureAccessDenied } from "@/lib/features/guard";
import {
  churchYear,
  depositsCsv,
  donorsCsv,
  isSpreadsheetKind,
  recurringCsv,
  spreadsheetFilename,
  type SpreadsheetKind,
} from "@/lib/giving/spreadsheet";
import {
  loadDepositSheetRows,
  loadDonorSheetRows,
  loadRecurringSheetRows,
} from "@/lib/giving/spreadsheet-data";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { isStripeConfigured } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ kind: string }> };

const WHAT: Record<SpreadsheetKind, string> = {
  donors: "donors",
  recurring: "recurring gifts",
  deposits: "deposits",
};

/**
 * GET /api/dashboard/giving/export/{donors|recurring|deposits}
 *
 * The full list behind each Giving page as a spreadsheet (CSV), for church
 * admins only — the same rule as the gifts download, since these carry donor
 * names, emails and amounts.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { kind } = await context.params;

  let auth;
  try {
    auth = await requireChurchAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    if (message === "Forbidden") return forbiddenResponse();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await featureAccessDenied("giving");
  if (denied) return denied;

  if (!isSpreadsheetKind(kind)) {
    return NextResponse.json(
      { error: "We couldn't tell which spreadsheet you wanted. Refresh the page and try again." },
      { status: 404 },
    );
  }

  const timeZone = auth.churchTimezone || "America/New_York";
  const now = new Date();

  let csv: string;
  let count: number;
  try {
    if (kind === "donors") {
      const rows = await loadDonorSheetRows(auth.churchId, timeZone, now);
      csv = donorsCsv(rows, timeZone, churchYear(now, timeZone));
      count = rows.length;
    } else if (kind === "recurring") {
      const rows = await loadRecurringSheetRows(auth.churchId);
      csv = recurringCsv(rows, timeZone);
      count = rows.length;
    } else {
      const profile = await getChurchGivingProfile(auth.churchId);
      if (!profile?.stripeAccountId || !isStripeConfigured()) {
        return NextResponse.json(
          { error: "Connect your church's bank on the Giving page first, then deposits can be downloaded." },
          { status: 409 },
        );
      }
      const rows = await loadDepositSheetRows(profile.stripeAccountId);
      csv = depositsCsv(rows, timeZone);
      count = rows.length;
    }
  } catch (error) {
    console.error(`[giving] ${kind} spreadsheet failed`, error);
    return NextResponse.json(
      { error: `We couldn't make the ${WHAT[kind]} spreadsheet. Nothing was changed. Please try again.` },
      { status: 500 },
    );
  }

  await logAdminAction({
    churchId: auth.churchId,
    taskName: `Downloaded a spreadsheet of ${count} ${WHAT[kind]}`,
    triggerSource: `admin:export:${kind}`,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${spreadsheetFilename(kind, now, timeZone)}"`,
      "Cache-Control": "no-store",
    },
  });
}
