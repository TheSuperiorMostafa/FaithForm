import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { retryPendingDonationReceipts } from "@/lib/stripe/receipt-delivery";

export async function GET(request: Request) {
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await retryPendingDonationReceipts();
  return NextResponse.json({ ok: true, ...result });
}
