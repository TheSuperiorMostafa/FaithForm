import { NextResponse } from "next/server";
import { getIntegration } from "@/lib/integrations/tokens";
import type { StreamIntegrationMetadata } from "@/lib/integrations/types";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  getStreamDestinationsFromMetadata,
  parseStreamPath,
} from "@/lib/stream/relay";
import { verifyIngestToken } from "@/lib/stream/ingest-token";
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
  const providedSecret = request.headers.get("x-stream-relay-secret");
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

  if (body.action === "read" || body.action === "playback") {
    const isLoopbackRtsp =
      body.protocol === "rtsp" &&
      (body.ip === "127.0.0.1" || body.ip === "::1");
    const isPlaybackProxy =
      body.user === "faithform-playback" &&
      compareSecret(
        body.password ?? null,
        process.env.STREAM_RELAY_PLAYBACK_SECRET,
      );
    if (!isLoopbackRtsp && !isPlaybackProxy) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "publish") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsedPath = parseStreamPath(body.path ?? "");
  if (!parsedPath || parsedPath.legacyCredentialInPath) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 401 });
  }

  const queryToken = new URLSearchParams(body.query ?? "").get("token");
  const suppliedToken = queryToken || body.password?.trim() || body.token?.trim();
  const capability = suppliedToken ? verifyIngestToken(suppliedToken) : null;
  if (!capability || capability.churchId !== parsedPath.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await getIntegration(parsedPath.churchId, "stream");
  if (!integration?.access_token) {
    return NextResponse.json({ error: "Stream not configured" }, { status: 401 });
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
    destinationCount: destinations.length,
  });
}
