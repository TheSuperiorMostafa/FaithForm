import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  buildRecordingStoragePath,
  sanitizeRecordingFilename,
  STREAM_RECORDINGS_BUCKET,
} from "@/lib/stream/recording-storage";
import { parseStreamPath } from "@/lib/stream/relay";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hands the relay a one-off URL for uploading a finished service recording.
 *
 * The file goes straight from the relay box to Supabase Storage. Routing a
 * multi-gigabyte MP4 through this app is not an option — the request body cap
 * on serverless is a few megabytes — which is why recordings used to be
 * announced but never actually stored, and every one of them sat on the Media
 * page saying "processing" forever.
 */
export async function POST(request: Request) {
  const providedSecret = request.headers.get("x-stream-relay-secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { path?: string; filename?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseStreamPath(body.path ?? "");
  if (!parsed) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 400 });
  }

  const filename = sanitizeRecordingFilename(body.filename ?? "");
  if (!filename) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const storagePath = buildRecordingStoragePath(parsed.churchId, filename);
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(STREAM_RECORDINGS_BUCKET)
    // Upsert so a retried upload replaces a half-written object rather than
    // failing and stranding the recording on the relay's disk.
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (error || !data) {
    const message = error?.message ?? "Could not create an upload URL.";
    console.error("recording-upload-url:", message);
    return NextResponse.json(
      {
        error: /bucket|not exist|resource/i.test(message)
          ? `The ${STREAM_RECORDINGS_BUCKET} storage bucket is missing. Run: pnpm storage:buckets`
          : message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ uploadUrl: data.signedUrl, storagePath });
}
