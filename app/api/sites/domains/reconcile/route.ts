import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { runDomainChecks } from "@/lib/sites/domain-onboarding";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  if (!compareSecret(token, process.env.CRON_SECRET)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runDomainChecks();
  return NextResponse.json({ ok: !result.failed, ...result }, { status: result.failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
