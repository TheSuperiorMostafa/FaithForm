import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { retryPendingSyndication } from "@/lib/stream/syndication";

export async function GET(request: Request) {
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.STREAM_CRON_SECRET ?? process.env.CRON_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await retryPendingSyndication();
  return NextResponse.json(result);
}
