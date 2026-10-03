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
export const maxDuration = 60;

export async function GET(request: Request) {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const signal = AbortSignal.timeout(45_000);
  const [cleanup, kiosk] = await Promise.allSettled([
    runAttendanceCleanup({ signal }),
    runKioskCleanup(new Date(), undefined, signal),
  ]);
  if (cleanup.status === "rejected" || kiosk.status === "rejected") {
    return NextResponse.json(
      { ok: false, error: "Attendance cleanup failed. Retry the job." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, durationMs: Date.now() - startedAt, ...cleanup.value, kioskRevoked: kiosk.value.revoked },
    { headers: { "Cache-Control": "no-store" } },
  );
}
