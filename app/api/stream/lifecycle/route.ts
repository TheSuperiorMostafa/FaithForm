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
    // Only the flag. The session stays live until an operator ends it —
    // `enableAutoStop` is off on YouTube so a momentary encoder gap cannot end a
    // service, and ending it here would reintroduce exactly that.
    await setPreviewIngestActive(parsedPath.churchId, false);
  }

  return NextResponse.json({ ok: true });
}
