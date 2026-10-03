import { NextResponse } from "next/server";

import { compareSecret } from "@/lib/security/compare-secret";
import { runAccountDeletions } from "@/lib/faithform/account-deletion";
import { runRecurringGiftCancellationWorker } from "@/lib/giving/v1/recurring-cancellation-jobs";

/**
 * Finishes the account deletions people requested in the app.
 *
 * Registered hourly in `vercel.json`, and the only thing that runs
 * `runAccountDeletions`. See `lib/faithform/account-deletion.ts` for what a
 * deletion removes, what a church keeps, and why the request route does not do
 * this itself.
 *
 * The repository's cron convention, unchanged: a GET protected by a
 * constant-time `CRON_SECRET` comparison, which Vercel sends as a Bearer token.
 * This route deletes sign-in identities, so the generic 401 matters more here
 * than anywhere: it must not tell a prober whether a secret is configured.
 *
 * Overlapping invocations are safe: each request is claimed with a conditional
 * update before it is touched, so two runs never work the same one.
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    // Both queues run even if the other fails; cancellations outlive deleted accounts.
    const [deletion, cancellation] = await Promise.allSettled([
      runAccountDeletions({ limit: parseLimit(request) }),
      runRecurringGiftCancellationWorker({ limit: parseLimit(request) }),
    ]);
    if (deletion.status === "rejected" || cancellation.status === "rejected") throw new Error("deletion_queue_unavailable");
    const result = deletion.value;
    const cancellations = cancellation.value;

    // Counts only. No request, account or user identifier leaves this route;
    // the per-request detail is in the function log, by request id.
    return NextResponse.json(
      { ok: true, durationMs: Date.now() - startedAt, ...result, cancellations },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // A queue failure remains retryable; completed work in either queue is durable.
    console.error("[account-deletion] queue processing failed");
    return NextResponse.json(
      { ok: false },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
