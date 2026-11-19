import { NextResponse } from "next/server";

import { sweepAutoTranscriptions } from "@/lib/sermon-media/auto";
import { cleanUpDeletedRecordings } from "@/lib/sermon-media/cleanup";
import { dispatchDueJobs, logSermonMedia } from "@/lib/sermon-media/jobs";
import { reconcileOpenReelPosts } from "@/lib/sermon-media/reel-runtime";
import { postDueClips, runAutoPipelines } from "@/lib/sermon-media/studio";
import { compareSecret } from "@/lib/security/compare-secret";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sermon media reconciler (Vercel cron, every minute).
 *
 * 1. Queue transcription for newly verified recordings of opted-in churches.
 * 2. Cancel work for deleted recordings; clean up purged ones.
 * 3. Reclaim expired leases and dispatch due jobs within the caps.
 * 4. Advance Facebook Reel posts that are processing or need a check.
 * Each step is idempotent, and one failing does not stop the others.
 */
export async function GET(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!compareSecret(provided, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.SERMON_MEDIA_ENABLED !== "1") {
    return NextResponse.json({ ok: true, disabled: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const db = createAdminClient();
  const report: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      report[name] = await run();
    } catch (error) {
      report[name] = { error: error instanceof Error ? error.message.slice(0, 160) : "failed" };
    }
    report[`${name}_ms`] = Date.now() - started;
  };

  await step("sweep", () => sweepAutoTranscriptions(db));
  await step("cleanup", () => cleanUpDeletedRecordings(db));
  await step("pipeline", () => runAutoPipelines(db));
  await step("dispatch", () => dispatchDueJobs({ db }));
  await step("scheduled_posts", () => postDueClips(db));
  await step("reels", () => reconcileOpenReelPosts(db));

  // Queue depth and age, for alerting on a backed-up Sunday.
  const { data: queued } = await db
    .from("media_jobs")
    .select("kind, created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1000);
  const oldest = queued?.[0]?.created_at ? Date.now() - new Date(queued[0].created_at).getTime() : 0;
  report.queue = { depth: queued?.length ?? 0, oldestAgeSec: Math.round(oldest / 1000) };

  logSermonMedia("reconciled", report);
  return NextResponse.json({ ok: true, ...report }, { headers: { "Cache-Control": "no-store" } });
}
