import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  isRecordingStoragePathForChurch,
  STREAM_RECORDINGS_BUCKET,
} from "@/lib/stream/recording-storage";
import { createStreamRecording } from "@/lib/stream/recordings";
import { parseStreamPath } from "@/lib/stream/relay";
import { getActiveStreamSession } from "@/lib/stream/sessions";
import { createAdminClient } from "@/lib/supabase/admin";

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
  // file behind it does. A recording announced without its upload is exactly
  // what left the library stuck on "processing" with nothing to play.
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

  const session = await getActiveStreamSession(parsed.churchId);
  const recording = await createStreamRecording({
    churchId: parsed.churchId,
    streamSessionId: session?.id ?? null,
    storagePath: body.storagePath,
    durationSec: body.durationSec ?? null,
    title: session?.title ?? "Service recording",
  });

  return NextResponse.json({ ok: true, recordingId: recording.id });
}
