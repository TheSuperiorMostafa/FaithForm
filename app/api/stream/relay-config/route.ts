import { NextResponse } from "next/server";
import { getIntegration } from "@/lib/integrations/tokens";
import type { StreamIntegrationMetadata } from "@/lib/integrations/types";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  getStreamDestinationsFromMetadata,
  parseStreamPath,
} from "@/lib/stream/relay";

export async function GET(request: Request) {
  const providedSecret = request.headers.get("x-stream-relay-secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const parsedPath = parseStreamPath(path);
  if (!parsedPath || parsedPath.legacyCredentialInPath) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 400 });
  }

  const integration = await getIntegration(parsedPath.churchId, "stream");
  if (!integration) {
    return NextResponse.json({ error: "Stream not configured" }, { status: 404 });
  }

  const metadata = (integration.metadata ?? {}) as StreamIntegrationMetadata;
  const destinations = getStreamDestinationsFromMetadata(metadata);

  return NextResponse.json({
    destinations,
  });
}
