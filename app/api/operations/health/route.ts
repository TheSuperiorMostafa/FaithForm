import { NextResponse } from "next/server";
import { checkOperationsHealth } from "@/lib/operations/health";
import { compareSecret } from "@/lib/security/compare-secret";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A monitor may poll this; it never runs workers or sends messages. */
export async function GET(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const health = await checkOperationsHealth();
    return NextResponse.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Operations health unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
