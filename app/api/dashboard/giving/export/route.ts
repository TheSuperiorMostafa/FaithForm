import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { searchAllGifts } from "@/lib/queries/giving";
import type { DonationStatus, GiftType, GiftsSearchFilters } from "@/types/giving";
import { featureAccessDenied } from "@/lib/features/guard";

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);

  const filters: GiftsSearchFilters = {
    search: searchParams.get("search") ?? undefined,
    fundId: searchParams.get("fundId") ?? undefined,
    giftType: (searchParams.get("giftType") as GiftType) || undefined,
    status: (searchParams.get("status") as DonationStatus) || undefined,
    dateFrom: searchParams.get("dateFrom")
      ? new Date(searchParams.get("dateFrom")!).toISOString()
      : undefined,
    dateTo: searchParams.get("dateTo")
      ? new Date(`${searchParams.get("dateTo")}T23:59:59`).toISOString()
      : undefined,
  };

  let donations;
  try {
    // Every matching gift, not just the first page the database returns.
    donations = await searchAllGifts(auth.churchId, filters);
  } catch (error) {
    console.error("[giving] export failed", error);
    return NextResponse.json(
      { error: "We couldn't make the spreadsheet. Please try again." },
      { status: 500 },
    );
  }

  const header = [
    "date",
    "donor",
    "email",
    "amount",
    "fund",
    "type",
    "status",
    "stripe_fee",
    "net",
    "refund_reason",
  ].join(",");

  const rows = donations.map((d) =>
    [
      new Date(d.createdAt).toISOString(),
      d.donorName ?? "",
      d.donorEmail ?? "",
      (d.amountCents / 100).toFixed(2),
      d.fundName ?? "",
      d.giftType,
      d.status,
      d.stripeFeeCents != null ? (d.stripeFeeCents / 100).toFixed(2) : "",
      d.netAmountCents != null ? (d.netAmountCents / 100).toFixed(2) : "",
      d.refundReason ?? "",
    ]
      .map(escapeCsv)
      .join(","),
  );

  const csv = [header, ...rows].join("\n");

  await logAdminAction({
    churchId: auth.churchId,
    taskName: `Exported ${donations.length} gifts to CSV`,
    triggerSource: "admin:export:gifts",
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="gifts-export.csv"`,
    },
  });
}
