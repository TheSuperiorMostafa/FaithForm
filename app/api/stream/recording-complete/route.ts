import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  isRecordingStoragePathForChurch,
  STREAM_RECORDINGS_BUCKET,
} from "@/lib/stream/recording-storage";
import { createStreamRecording } from "@/lib/stream/recordings";
import { verifyRecording } from "@/lib/media/v1/rendition-check";
import { parseStreamPath } from "@/lib/stream/relay";
import { defaultRecordingTitle, pickSessionForSegment } from "@/lib/stream/recording-model";
import { createSupabaseRecordingRepo } from "@/lib/stream/recording-repo";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The legacy single-file recording callback.
 *
 * Kept for a relay that has not yet been redeployed with the segmented
 * recorder (see docs/faithform/P15_LIVESTREAM_RECORDING_LIFECYCLE.md). It used
 * to look up the church's *active* session — which had always ended by the
 * time this ran — so every recording arrived orphaned and untitled. It now
 * binds the file to the broadcast whose window contains it, by the time the
 * relay encoded into the file name.
 */
export async function POST(request: Request) {
  const providedSecret = request.headers.get("x-stream-relay-secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    path?: string;
    storagePath?: string;
    durationSec?: number;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseStreamPath(body.path ?? "");
  if (!parsed || !body.storagePath) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!isRecordingStoragePathForChurch(body.storagePath, parsed.churchId)) {
    return NextResponse.json(
      { error: "Storage path does not belong to this church" },
      { status: 400 },
    );
  }

  // The row is what the Media page renders, so it must not exist unless the
  // file behind it does.
  const admin = createAdminClient();
  const { data: signed } = await admin.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(body.storagePath, 60);

  if (!signed?.signedUrl) {
    return NextResponse.json(
      { error: "Recording file was not found in storage" },
      { status: 409 },
    );
  }

  const durationSec =
    typeof body.durationSec === "number" && Number.isFinite(body.durationSec) && body.durationSec > 0
      ? body.durationSec
      : null;

  // `stream_<digest>-<epoch seconds>.mp4`: the epoch is when recording began.
  const epoch = /-(\d{9,11})\.(mp4|mov|mkv)$/i.exec(body.storagePath)?.[1];
  const startedAt = epoch ? new Date(Number(epoch) * 1000).toISOString() : null;

  const repo = createSupabaseRecordingRepo(admin);
  let session = null as Awaited<ReturnType<typeof repo.getSession>>;
  if (startedAt) {
    const until = new Date(Date.parse(startedAt) + (durationSec ?? 60) * 1000).toISOString();
    session = pickSessionForSegment(
      { startedAt, durationSec: durationSec ?? 60 },
      await repo.listSessionsInRange(parsed.churchId, startedAt, until),
    );
  }

  // A redeployed relay records the same broadcast as segments. Never make a
  // second media item for one service.
  if (session && (await repo.getRecordingForSession(parsed.churchId, session.id))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const [church, event] = await Promise.all([
    repo.getChurch(parsed.churchId),
    session?.streamEventId ? repo.getEvent(parsed.churchId, session.streamEventId) : null,
  ]);

  const recording = await createStreamRecording({
    churchId: parsed.churchId,
    streamSessionId: session?.id ?? null,
    streamEventId: session?.streamEventId ?? null,
    storagePath: body.storagePath,
    durationSec,
    title: defaultRecordingTitle(
      event?.title ?? session?.title ?? null,
      startedAt ?? new Date().toISOString(),
      church?.timezone ?? "America/New_York",
    ),
    recordingStartedAt: startedAt,
  });

  // Prove what actually landed, straight away. Not fatal: the row is the
  // record that a service happened, and the verdict is retaken later.
  await verifyRecording(
    {
      recordingId: recording.id,
      churchId: parsed.churchId,
      storagePath: body.storagePath,
    },
    admin,
  ).catch(() => null);

  return NextResponse.json({ ok: true, recordingId: recording.id });
}
