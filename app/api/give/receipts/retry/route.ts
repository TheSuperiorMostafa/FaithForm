import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { reconcileDonationFees } from "@/lib/stripe/gift-fees";
import { retryPendingDonationReceipts } from "@/lib/stripe/receipt-delivery";

export async function GET(request: Request) {
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [receipts, fees] = await Promise.allSettled([
    retryPendingDonationReceipts(),
    reconcileDonationFees(),
  ]);
  if (receipts.status === "rejected" || fees.status === "rejected") {
    console.error("[giving] scheduled receipt or fee check failed");
    return NextResponse.json({ error: "Giving maintenance failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...receipts.value, ...fees.value });
}
