import { NextResponse } from "next/server";

import { compareSecret } from "@/lib/security/compare-secret";
import {
  runOccurrenceGeneration,
  runOccurrenceLifecycle,
} from "@/lib/attendance/v2/jobs";

/**
 * Materializes the occurrence horizon and advances occurrence status.
 *
 * Follows the repository's cron convention: GET, Bearer `CRON_SECRET`,
 * constant-time comparison, generic 401.
 *
 * Overlap-safe without a lock. Generation is idempotent at the database level,
 * and the lifecycle updates are set-based, so two concurrent invocations
 * produce the same end state.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const signal = AbortSignal.timeout(90_000);
  const [lifecycle, generation] = await Promise.allSettled([
    runOccurrenceLifecycle(new Date(), undefined, signal),
    runOccurrenceGeneration({ signal }),
  ]);
  if (lifecycle.status === "rejected" || generation.status === "rejected") {
    return NextResponse.json(
      { ok: false, error: "Attendance maintenance failed. Retry the job." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  const failed = generation.value.churchesFailed > 0 || generation.value.churchesDeferred > 0;

  // Counts only. No church name, no schedule, no attendance.
  return NextResponse.json(
    { ok: !failed, durationMs: Date.now() - startedAt, ...generation.value, ...lifecycle.value },
    { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
