import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { startDueScheduledEvents } from "@/lib/stream/scheduled";
import { retryPendingSyndication } from "@/lib/stream/syndication";

export const maxDuration = 60;

export async function GET(request: Request) {
  const provided = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "") ?? null;
  const expected = process.env.STREAM_CRON_SECRET ?? process.env.CRON_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [scheduled, syndication] = await Promise.allSettled([
    startDueScheduledEvents(),
    retryPendingSyndication(),
  ]);

  if (scheduled.status === "rejected" || syndication.status === "rejected") {
    return NextResponse.json({ ok: false, error: "Stream maintenance failed. Retry the job." },
      { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  const failed = scheduled.value.failed > 0;
  return NextResponse.json({
    ok: !failed,
    scheduled: scheduled.value,
    syndication: syndication.value,
  }, { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
