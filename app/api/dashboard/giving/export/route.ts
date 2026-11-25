import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { searchAllGifts } from "@/lib/queries/giving";
import { parseGiftMethod } from "@/lib/giving/labels";
import type { DonationStatus, GiftType, GiftsSearchFilters } from "@/types/giving";
import { featureAccessDenied } from "@/lib/features/guard";
import { csvCell } from "@/lib/utils/csv";
import { createAdminClient } from "@/lib/supabase/admin";
import { listChurchStripeAccounts } from "@/lib/giving/stripe-accounts";

/**
 * Which bank each gift went to: the account that took it, shown by its label
 * and its bank's last four digits. Offline gifts took no Stripe charge and
 * show neither. Read after the search so the gifts query stays unchanged.
 */
async function bankColumnsByGift(
  churchId: string,
  giftIds: string[],
): Promise<Map<string, { account: string; last4: string }>> {
  const result = new Map<string, { account: string; last4: string }>();
  if (!giftIds.length) return result;
  const admin = createAdminClient();
  const accounts = await listChurchStripeAccounts(churchId, admin);
  if (!accounts.length) return result;
  const byStripeId = new Map(accounts.map((a) => [a.stripeAccountId, a]));
  for (let i = 0; i < giftIds.length; i += 500) {
    const { data, error } = await admin
      .from("giving_donations")
      .select("id, stripe_account_id")
      .eq("church_id", churchId)
      .in("id", giftIds.slice(i, i + 500));
    if (error) throw new Error("gift bank read failed");
    for (const row of data ?? []) {
      const account = byStripeId.get(row.stripe_account_id as string);
      if (account) result.set(row.id as string, { account: account.label, last4: account.bankLast4 ?? "" });
    }
  }
  return result;
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
    method: parseGiftMethod(searchParams.get("method")),
    status: (searchParams.get("status") as DonationStatus) || undefined,
    dateFrom: searchParams.get("dateFrom")
      ? new Date(searchParams.get("dateFrom")!).toISOString()
      : undefined,
    dateTo: searchParams.get("dateTo")
      ? new Date(`${searchParams.get("dateTo")}T23:59:59`).toISOString()
      : undefined,
  };

  let donations;
  let banks: Map<string, { account: string; last4: string }>;
  try {
    // Every matching gift, not just the first page the database returns.
    donations = await searchAllGifts(auth.churchId, filters);
    banks = await bankColumnsByGift(auth.churchId, donations.map((d) => d.id));
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
    "method",
    "status",
    "stripe_fee",
    "net",
    "refund_reason",
    "bank_account",
    "bank_last4",
  ].join(",");

  const rows = donations.map((d) =>
    [
      new Date(d.createdAt).toISOString(),
      d.donorName ?? "",
      d.donorEmail ?? "",
      (d.amountCents / 100).toFixed(2),
      d.fundName ?? "",
      d.giftType,
      d.method,
      d.status,
      d.stripeFeeCents != null ? (d.stripeFeeCents / 100).toFixed(2) : "",
      d.netAmountCents != null ? (d.netAmountCents / 100).toFixed(2) : "",
      d.refundReason ?? "",
      banks.get(d.id)?.account ?? "",
      banks.get(d.id)?.last4 ?? "",
    ]
      .map(csvCell)
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
