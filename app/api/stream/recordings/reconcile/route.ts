import { NextResponse } from "next/server";

import { getIntegration } from "@/lib/integrations/tokens";
import { compareSecret } from "@/lib/security/compare-secret";
import { endLiveBroadcast } from "@/lib/stream/go-live";
import { logRecordingEvent, reconcileRecordings } from "@/lib/stream/recording-lifecycle";
import { productionLifecycleDeps } from "@/lib/stream/recording-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The recording reconciler (Vercel cron, every two minutes).
 *
 * Compares FaithForm's broadcast and recording state with what the relay and
 * storage prove, and repairs the difference: a missed "ended", a commit that
 * never arrived, a relay that died mid-service, a recording ready but never
 * verified or auto-published, a broadcast nobody ended, and deleted media still
 * in storage. Every repair is idempotent; running it twice is running it once.
 */
export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deps = productionLifecycleDeps();
  const report = await reconcileRecordings(deps, {
    endAbandonedSession: async (session) => {
      await endLiveBroadcast(session.churchId);
    },
    ingestHeartbeatAt: async (churchId) => {
      const [status, integration] = await Promise.all([
        deps.repo.getIngestStatus(churchId),
        getIntegration(churchId, "stream"),
      ]);
      const meta = (integration?.metadata ?? {}) as { preview_ingest_active?: boolean; preview_ingest_at?: string };
      const beats = [
        status?.publishing ? status.heartbeatAt : null,
        meta.preview_ingest_active ? (meta.preview_ingest_at ?? null) : null,
      ].filter((value): value is string => Boolean(value));
      return beats.sort().at(-1) ?? null;
    },
  });

  logRecordingEvent("reconciled", report);
  return NextResponse.json({ ok: true, ...report }, { headers: { "Cache-Control": "no-store" } });
}
