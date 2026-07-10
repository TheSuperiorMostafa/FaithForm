import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const provided =
    request.headers.get("x-stream-relay-secret") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const relayHost =
    process.env.NEXT_PUBLIC_STREAM_RELAY_HOST ??
    process.env.STREAM_RELAY_HOST ??
    "stream.faithform.io";

  const admin = createAdminClient();
  const { count: liveSessions } = await admin
    .from("stream_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "live");

  return NextResponse.json({
    ok: true,
    relayHost,
    liveSessions: liveSessions ?? 0,
    checkedAt: new Date().toISOString(),
  });
}
