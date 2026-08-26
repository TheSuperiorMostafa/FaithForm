import { NextResponse } from "next/server";

import { compareSecret } from "@/lib/security/compare-secret";
import { runNotificationWorker } from "@/lib/faithful/push/outbox";

/**
 * The notification delivery worker's invocation path.
 *
 * Follows the repository's established cron convention exactly: a GET protected
 * by a constant-time `CRON_SECRET` comparison, registered in `vercel.json`,
 * the same shape as the weekly-draft, keep-alive, and receipt-retry jobs.
 *
 * Overlap is safe by construction rather than by scheduling discipline. Jobs are
 * claimed under a lease with `FOR UPDATE SKIP LOCKED`, so two concurrent
 * invocations claim disjoint sets, and a worker that dies mid-send has its
 * lease expire rather than stranding the job. That means this route does not
 * need — and deliberately does not use — a global lock that would itself become
 * a stuck-state to recover from.
 */
export const dynamic = "force-dynamic";

/** Bounded so one invocation cannot exceed the function's time budget. */
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

function parseLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return DEFAULT_BATCH;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_BATCH;
  return Math.min(parsed, MAX_BATCH);
}

export async function GET(request: Request) {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;

  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    // Deliberately generic and unconditional: distinguishing "no secret
    // configured" from "wrong secret" would tell a prober which it is.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const result = await runNotificationWorker({ limit: parseLimit(request) });

  // Counts only. No notification body, no device token, no church or account
  // identifier — this response is observability, not a data export.
  return NextResponse.json(
    {
      ok: true,
      durationMs: Date.now() - startedAt,
      ...result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
