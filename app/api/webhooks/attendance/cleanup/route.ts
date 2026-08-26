import { NextResponse } from "next/server";

import { compareSecret } from "@/lib/security/compare-secret";
import { runAttendanceCleanup, runKioskCleanup } from "@/lib/attendance/v2/jobs";

/**
 * Purges short-lived validation evidence, expires stalled attempts, and
 * disables expired kiosk credentials.
 *
 * The evidence purge is the privacy-load-bearing one: precise validation data
 * exists to answer a support question and is emptied on the policy's schedule.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const cleanup = await runAttendanceCleanup();
  const kiosk = await runKioskCleanup();

  return NextResponse.json(
    { ok: true, durationMs: Date.now() - startedAt, ...cleanup, kioskRevoked: kiosk.revoked },
    { headers: { "Cache-Control": "no-store" } },
  );
}
