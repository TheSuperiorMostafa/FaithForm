import { NextResponse } from "next/server";
import { getIntegration } from "@/lib/integrations/tokens";
import type { StreamIntegrationMetadata } from "@/lib/integrations/types";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  getStreamDestinationsFromMetadata,
  isValidStreamPublishKey,
  parseStreamPath,
} from "@/lib/stream/relay";
import { onIngestStarted } from "@/lib/stream/go-live";
import { setPreviewIngestActive } from "@/lib/stream/preview-ingest";

type MediaMTXAuthRequest = {
  user?: string;
  password?: string;
  token?: string;
  ip?: string;
  action?: string;
  path?: string;
  protocol?: string;
  id?: string;
  query?: string;
  userAgent?: string;
};

export async function POST(request: Request) {
  const url = new URL(request.url);
  const providedSecret = url.searchParams.get("secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: MediaMTXAuthRequest;
  try {
    body = (await request.json()) as MediaMTXAuthRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "publish") {
    return NextResponse.json({ ok: true, ignored: body.action ?? "unknown" });
  }

  const parsedPath = parseStreamPath(body.path ?? "");
  if (!parsedPath || !isValidStreamPublishKey(parsedPath.publishKey)) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 401 });
  }

  const integration = await getIntegration(parsedPath.churchId, "stream");
  if (!integration?.access_token) {
    return NextResponse.json({ error: "Stream not configured" }, { status: 401 });
  }

  if (integration.access_token !== parsedPath.publishKey) {
    const password = body.password?.trim() ?? "";
    if (!password || integration.access_token !== password) {
      return NextResponse.json({ error: "Invalid stream key" }, { status: 401 });
    }
  }

  await setPreviewIngestActive(parsedPath.churchId, true);

  const destinations = getStreamDestinationsFromMetadata(
    (integration.metadata ?? {}) as StreamIntegrationMetadata,
  );

  if (destinations.length > 0) {
    await onIngestStarted(parsedPath.churchId);
  }

  return NextResponse.json({
    ok: true,
    churchId: parsedPath.churchId,
    destinationCount: destinations.length,
  });
}
