import { NextResponse } from "next/server";

import { compareSecret } from "@/lib/security/compare-secret";
import { retryPendingSupportNotionTickets } from "@/lib/support/notion-delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await retryPendingSupportNotionTickets();
  return NextResponse.json(
    { ok: result.configured && !result.failed, ...result },
    {
      status: result.failed || !result.configured ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
