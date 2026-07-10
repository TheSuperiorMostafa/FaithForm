import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { onIngestStarted } from "@/lib/stream/go-live";
import { setPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { markStreamEnded } from "@/lib/stream/sessions";
import { parseStreamPath } from "@/lib/stream/relay";

export async function POST(request: Request) {
  const providedSecret =
    request.headers.get("x-stream-relay-secret") ??
    new URL(request.url).searchParams.get("secret");
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
  if (!parsedPath) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 400 });
  }

  if (body.event === "publish") {
    await setPreviewIngestActive(parsedPath.churchId, true);
    await onIngestStarted(parsedPath.churchId);
  } else if (body.event === "unpublish") {
    await setPreviewIngestActive(parsedPath.churchId, false);
    await markStreamEnded(parsedPath.churchId);
  }

  return NextResponse.json({ ok: true });
}
