import { NextResponse } from "next/server";

import { purgeWebhookReceipts } from "@/lib/messaging/webhooks";
import { compareSecret } from "@/lib/security/compare-secret";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Nightly Groups upkeep:
 *
 *   - generates the next eight weeks of gatherings from every active meeting
 *     schedule (idempotent: one gathering per schedule per start time);
 *   - purges webhook receipts older than 30 days and finished outbox jobs
 *     older than 14 days (failed ones are kept for a person to look at).
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const admin = createAdminClient();
  const { data: generated, error } = await admin.rpc("generate_group_events", {
    p_church_id: null,
    p_group_id: null,
    p_horizon_days: 56,
  });
  if (error) console.error("[groups] gathering generation failed");

  await purgeWebhookReceipts(admin, 30);
  await admin
    .from("messaging_sync_jobs")
    .delete()
    .in("status", ["done", "cancelled"])
    .lt("completed_at", new Date(Date.now() - 14 * 86_400_000).toISOString());

  return NextResponse.json(
    { ok: !error, generated: Number(generated ?? 0), durationMs: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
