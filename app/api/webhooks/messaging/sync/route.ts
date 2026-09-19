import { NextResponse } from "next/server";

import { runMessagingSync } from "@/lib/messaging/sync/worker";
import { compareSecret } from "@/lib/security/compare-secret";

/**
 * Drains the messaging outbox: every change FaithForm made that the chat
 * provider has not caught up with yet (memberships, roles, archived groups,
 * blocks, suspensions, devices, notification choices, deletions).
 *
 * Same convention as the notification worker: GET, `CRON_SECRET` compared in
 * constant time, registered in `vercel.json`. Overlapping runs are safe —
 * jobs are leased with SKIP LOCKED — and a run stops claiming work before the
 * function's time budget.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const totals = { configured: true, claimed: 0, done: 0, retried: 0, failed: 0, batches: 0 };
  const started = Date.now();
  // Several batches per invocation, inside a 45-second budget.
  while (Date.now() - started < 40_000 && totals.batches < 8) {
    const result = await runMessagingSync({ limit: 50, budgetMs: Math.max(5_000, 45_000 - (Date.now() - started)) });
    totals.configured = result.configured;
    totals.claimed += result.claimed;
    totals.done += result.done;
    totals.retried += result.retried;
    totals.failed += result.failed;
    totals.batches += 1;
    if (!result.configured || result.claimed < 50) break;
  }

  // Counts only — never a person, a church, or a message.
  return NextResponse.json(
    { ok: true, durationMs: Date.now() - started, ...totals },
    { headers: { "Cache-Control": "no-store" } },
  );
}
