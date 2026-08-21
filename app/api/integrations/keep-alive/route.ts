import { NextResponse } from "next/server";
import { refreshExpiringIntegrations } from "@/lib/integrations/keep-alive";
import { compareSecret } from "@/lib/security/compare-secret";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Nightly keep-alive for connected integrations.
 *
 * Runs on the same CRON_SECRET as the announcement draft job.
 */
export async function GET(request: Request) {
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "") ?? null;

  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshExpiringIntegrations();
  return NextResponse.json({ ok: true, ...result });
}
