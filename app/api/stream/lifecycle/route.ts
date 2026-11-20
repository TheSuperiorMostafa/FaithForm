import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { onIngestStarted } from "@/lib/stream/go-live";
import { setPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { parseStreamPath } from "@/lib/stream/relay";

export async function POST(request: Request) {
  const providedSecret = request.headers.get("x-stream-relay-secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { event?: string; path?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsedPath = parseStreamPath(body.path ?? "");
  if (!parsedPath || parsedPath.legacyCredentialInPath) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 400 });
  }

  // The relay re-sends `publish` on a heartbeat for as long as an encoder is
  // publishing, which is what keeps `preview_ingest_active` honest. It also
  // gives the YouTube transition repeated chances to land: the attempt made at
  // go-live necessarily races the relay's destination poll, so on the first try
  // the bound stream is still inactive and YouTube refuses. Both calls no-op
  // once they have taken effect.
  if (body.event === "publish") {
    await setPreviewIngestActive(parsedPath.churchId, true);
    await onIngestStarted(parsedPath.churchId);
  } else if (body.event === "unpublish") {
    // Only the flag (and when it stopped). The service is not ended here: a
    // momentary encoder gap must not end it, which is also why `enableAutoStop`
    // is off on YouTube. If the video has not come back within
    // ENCODER_STOP_GRACE_MS, the status poll or the reconcile cron ends the
    // service exactly as End service does — see `lib/stream/video-stop.ts`.
    await setPreviewIngestActive(parsedPath.churchId, false);
  }

  return NextResponse.json({ ok: true });
}
